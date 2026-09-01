/**
 * FITSRenderer —— 非 React 的 WebGL2 渲染引擎。
 *
 * 生命周期独立于当前帧:编译/链接 shader 一次、纹理按 `sequenceId:frameIndex`
 * 缓存,播放热路径只做 bindTexture + setUniforms + drawArrays。纹理缓存按实际
 * R32F 字节计费并执行 LRU 淘汰，长序列不会无限占用显存。
 */

export interface ShowFrameParams {
  /** 纹理缓存 key,`${sequenceId}:${frameIndex}` */
  key: string
  pixels: Float32Array
  width: number
  height: number
  z1: number
  z2: number
  stretchMode: 'linear' | 'asinh'
  inverted: boolean
  alignment?: {
    reference: AlignmentWcs
    source: AlignmentWcs
    outputWidth: number
    outputHeight: number
  }
}

export interface AlignmentWcs {
  crpix1: number
  crpix2: number
  crval1: number
  crval2: number
  cd1_1: number
  cd1_2: number
  cd2_1: number
  cd2_2: number
}

interface TextureEntry {
  texture: WebGLTexture
  width: number
  height: number
  bytes: number
}

export interface RendererDiagnostics {
  backend: 'webgl2' | 'canvas2d'
  bytes: number
  entries: number
  evictions: number
  maxBytes: number
  fallbackReason: string | null
}

export interface FrameRenderer {
  prewarm(key: string, pixels: Float32Array, width: number, height: number): void
  showFrame(params: ShowFrameParams): void
  diagnostics(): RendererDiagnostics
  dispose(): void
}

const GPU_TEXTURE_BUDGET_BYTES = 256 * 1024 * 1024

const VERTEX_SOURCE = `#version 300 es
  out vec2 uv;
  void main() {
    vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    uv = pos;
    gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
  }`

const FRAGMENT_SOURCE = `#version 300 es
  precision highp float;
  uniform sampler2D image;
  uniform float blackPoint;
  uniform float whitePoint;
  uniform bool useAsinh;
  uniform bool inverted;
  uniform bool aligned;
  uniform vec2 outputSize;
  uniform vec2 sourceSize;
  uniform vec2 referenceCrpix;
  uniform vec2 referenceCrval;
  uniform mat2 referenceCd;
  uniform vec2 sourceCrpix;
  uniform vec2 sourceCrval;
  uniform mat2 sourceInvCd;
  in vec2 uv;
  out vec4 color;
  void main() {
    vec2 sampleUv = vec2(uv.x, 1.0 - uv.y);
    bool outside = false;
    if (aligned) {
      vec2 referencePixel = vec2(uv.x * outputSize.x, (1.0 - uv.y) * outputSize.y);
      vec2 tangent = radians(referenceCd * (referencePixel - referenceCrpix));
      float denominator = cos(referenceCrval.y) - tangent.y * sin(referenceCrval.y);
      float ra = referenceCrval.x + atan(tangent.x, denominator);
      float dec = atan(
        sin(referenceCrval.y) + tangent.y * cos(referenceCrval.y),
        sqrt(denominator * denominator + tangent.x * tangent.x)
      );
      float dra = ra - sourceCrval.x;
      float projectionDenominator = sin(dec) * sin(sourceCrval.y)
        + cos(dec) * cos(sourceCrval.y) * cos(dra);
      outside = projectionDenominator <= 0.0;
      vec2 sourceTangent = degrees(vec2(
        cos(dec) * sin(dra) / projectionDenominator,
        (sin(dec) * cos(sourceCrval.y) - cos(dec) * sin(sourceCrval.y) * cos(dra))
          / projectionDenominator
      ));
      vec2 sourcePixel = sourceCrpix + sourceInvCd * sourceTangent;
      outside = outside || sourcePixel.x < 0.0 || sourcePixel.y < 0.0
        || sourcePixel.x >= sourceSize.x || sourcePixel.y >= sourceSize.y;
      sampleUv = vec2(sourcePixel.x / sourceSize.x, 1.0 - sourcePixel.y / sourceSize.y);
    }
    float source = outside ? 0.0 : texture(image, sampleUv).r;
    float value = clamp((source - blackPoint) / max(whitePoint - blackPoint, 1.0e-20), 0.0, 1.0);
    if (useAsinh) value = asinh(value * 10.0) / asinh(10.0);
    if (inverted) value = 1.0 - value;
    if (isnan(source) || isinf(source)) value = inverted ? 1.0 : 0.0;
    color = vec4(value, value, value, 1.0);
  }`

export class FITSRenderer implements FrameRenderer {
  private gl: WebGL2RenderingContext
  private canvas: HTMLCanvasElement
  private program: WebGLProgram
  private textures = new Map<string, TextureEntry>()
  private uniforms: {
    image: WebGLUniformLocation | null
    blackPoint: WebGLUniformLocation | null
    whitePoint: WebGLUniformLocation | null
    useAsinh: WebGLUniformLocation | null
    inverted: WebGLUniformLocation | null
    aligned: WebGLUniformLocation | null
    outputSize: WebGLUniformLocation | null
    sourceSize: WebGLUniformLocation | null
    referenceCrpix: WebGLUniformLocation | null
    referenceCrval: WebGLUniformLocation | null
    referenceCd: WebGLUniformLocation | null
    sourceCrpix: WebGLUniformLocation | null
    sourceCrval: WebGLUniformLocation | null
    sourceInvCd: WebGLUniformLocation | null
  }
  private lostHandler: (event: Event) => void
  private restoredHandler: () => void
  private disposed = false
  private textureBytes = 0
  private evictionCount = 0
  private activeKey: string | null = null

  constructor(canvas: HTMLCanvasElement, onContextRestored: () => void) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false })
    if (!gl) throw new Error('WebGL2 不可用')
    this.gl = gl
    this.canvas = canvas

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)
      if (!shader) throw new Error('WebGL2 shader allocation failed')
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) ?? 'WebGL2 shader compile failed')
      }
      return shader
    }

    const program = gl.createProgram()
    if (!program) throw new Error('WebGL2 program allocation failed')
    const vertex = compile(gl.VERTEX_SHADER, VERTEX_SOURCE)
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SOURCE)
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'WebGL2 program link failed')
    }
    this.program = program

    this.uniforms = {
      image: gl.getUniformLocation(program, 'image'),
      blackPoint: gl.getUniformLocation(program, 'blackPoint'),
      whitePoint: gl.getUniformLocation(program, 'whitePoint'),
      useAsinh: gl.getUniformLocation(program, 'useAsinh'),
      inverted: gl.getUniformLocation(program, 'inverted'),
      aligned: gl.getUniformLocation(program, 'aligned'),
      outputSize: gl.getUniformLocation(program, 'outputSize'),
      sourceSize: gl.getUniformLocation(program, 'sourceSize'),
      referenceCrpix: gl.getUniformLocation(program, 'referenceCrpix'),
      referenceCrval: gl.getUniformLocation(program, 'referenceCrval'),
      referenceCd: gl.getUniformLocation(program, 'referenceCd'),
      sourceCrpix: gl.getUniformLocation(program, 'sourceCrpix'),
      sourceCrval: gl.getUniformLocation(program, 'sourceCrval'),
      sourceInvCd: gl.getUniformLocation(program, 'sourceInvCd'),
    }

    gl.useProgram(program)
    gl.activeTexture(gl.TEXTURE0)
    gl.uniform1i(this.uniforms.image, 0)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

    // context lost:只清空 JS 侧缓存,不调用任何 GL 删除(context 已失效)
    this.lostHandler = (event) => {
      event.preventDefault()
      this.textures.clear()
      this.textureBytes = 0
    }
    // context restored:通知组件 bump glEpoch,重建整个 renderer
    this.restoredHandler = () => onContextRestored()
    canvas.addEventListener('webglcontextlost', this.lostHandler, false)
    canvas.addEventListener('webglcontextrestored', this.restoredHandler, false)
  }

  /** 只上传纹理,不绘制。key 命中时跳过(会话内常驻,不重复上传)。 */
  prewarm(key: string, pixels: Float32Array, width: number, height: number) {
    this.ensureTexture(key, pixels, width, height)
  }

  showFrame(params: ShowFrameParams) {
    if (this.disposed) return
    const { gl } = this
    const { canvas } = this
    // 画布尺寸变化只 resize + viewport,绝不清空纹理(纹理属于 context,独立于 drawing buffer)
    const outputWidth = params.alignment?.outputWidth ?? params.width
    const outputHeight = params.alignment?.outputHeight ?? params.height
    if (canvas.width !== outputWidth || canvas.height !== outputHeight) {
      canvas.width = outputWidth
      canvas.height = outputHeight
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
    }
    const entry = this.ensureTexture(params.key, params.pixels, params.width, params.height)
    this.activeKey = params.key
    gl.bindTexture(gl.TEXTURE_2D, entry.texture)
    gl.useProgram(this.program)
    gl.uniform1f(this.uniforms.blackPoint, params.z1)
    gl.uniform1f(this.uniforms.whitePoint, params.z2)
    gl.uniform1i(this.uniforms.useAsinh, params.stretchMode === 'asinh' ? 1 : 0)
    gl.uniform1i(this.uniforms.inverted, params.inverted ? 1 : 0)
    gl.uniform1i(this.uniforms.aligned, params.alignment ? 1 : 0)
    gl.uniform2f(this.uniforms.outputSize, outputWidth, outputHeight)
    gl.uniform2f(this.uniforms.sourceSize, params.width, params.height)
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      params.alignment ? gl.LINEAR : gl.NEAREST,
    )
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MAG_FILTER,
      params.alignment ? gl.LINEAR : gl.NEAREST,
    )
    if (params.alignment)
      this.setAlignmentUniforms(params.alignment.reference, params.alignment.source)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private setAlignmentUniforms(reference: AlignmentWcs, source: AlignmentWcs) {
    const gl = this.gl
    gl.uniform2f(this.uniforms.referenceCrpix, reference.crpix1, reference.crpix2)
    gl.uniform2f(
      this.uniforms.referenceCrval,
      (reference.crval1 * Math.PI) / 180,
      (reference.crval2 * Math.PI) / 180,
    )
    gl.uniformMatrix2fv(
      this.uniforms.referenceCd,
      false,
      new Float32Array([reference.cd1_1, reference.cd2_1, reference.cd1_2, reference.cd2_2]),
    )
    const determinant = source.cd1_1 * source.cd2_2 - source.cd1_2 * source.cd2_1
    gl.uniform2f(this.uniforms.sourceCrpix, source.crpix1, source.crpix2)
    gl.uniform2f(
      this.uniforms.sourceCrval,
      (source.crval1 * Math.PI) / 180,
      (source.crval2 * Math.PI) / 180,
    )
    gl.uniformMatrix2fv(
      this.uniforms.sourceInvCd,
      false,
      new Float32Array([
        source.cd2_2 / determinant,
        -source.cd2_1 / determinant,
        -source.cd1_2 / determinant,
        source.cd1_1 / determinant,
      ]),
    )
  }

  diagnostics(): RendererDiagnostics {
    return {
      backend: 'webgl2',
      bytes: this.textureBytes,
      entries: this.textures.size,
      evictions: this.evictionCount,
      maxBytes: GPU_TEXTURE_BUDGET_BYTES,
      fallbackReason: null,
    }
  }

  /** 删除 program 与全部纹理,释放会话级 GL 资源。 */
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.canvas.removeEventListener('webglcontextlost', this.lostHandler, false)
    this.canvas.removeEventListener('webglcontextrestored', this.restoredHandler, false)
    const { gl } = this
    for (const entry of this.textures.values()) {
      gl.deleteTexture(entry.texture)
    }
    this.textures.clear()
    this.textureBytes = 0
    gl.deleteProgram(this.program)
  }

  private ensureTexture(
    key: string,
    pixels: Float32Array,
    width: number,
    height: number,
  ): TextureEntry {
    const existing = this.textures.get(key)
    if (existing) {
      this.textures.delete(key)
      this.textures.set(key, existing)
      return existing
    }
    const { gl } = this
    const texture = gl.createTexture()
    if (!texture) throw new Error('WebGL2 texture allocation failed')
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    // 不可变存储:一次分配、一次上传,驱动可提前规划布局
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, width, height)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.FLOAT, pixels)
    const bytes = width * height * Float32Array.BYTES_PER_ELEMENT
    const entry: TextureEntry = { texture, width, height, bytes }
    this.textures.set(key, entry)
    this.textureBytes += bytes
    this.evictTextures(key)
    return entry
  }

  private evictTextures(insertedKey: string) {
    const { gl } = this
    while (this.textureBytes > GPU_TEXTURE_BUDGET_BYTES && this.textures.size > 1) {
      const candidate = this.textures.keys().next().value as string | undefined
      if (!candidate) break
      if (candidate === insertedKey || candidate === this.activeKey) {
        const entry = this.textures.get(candidate)
        if (!entry) break
        this.textures.delete(candidate)
        this.textures.set(candidate, entry)
        if (
          [...this.textures.keys()].every((key) => key === insertedKey || key === this.activeKey)
        ) {
          break
        }
        continue
      }
      const entry = this.textures.get(candidate)
      if (!entry) break
      gl.deleteTexture(entry.texture)
      this.textures.delete(candidate)
      this.textureBytes -= entry.bytes
      this.evictionCount += 1
    }
  }
}

class CanvasFITSRenderer implements FrameRenderer {
  private readonly context: CanvasRenderingContext2D
  private imageData: ImageData | null = null
  private disposed = false

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly reason: string,
  ) {
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('Canvas 2D 不可用')
    this.context = context
  }

  prewarm() {}

  showFrame(params: ShowFrameParams) {
    if (this.disposed) return
    const outputWidth = params.alignment?.outputWidth ?? params.width
    const outputHeight = params.alignment?.outputHeight ?? params.height
    if (this.canvas.width !== outputWidth || this.canvas.height !== outputHeight) {
      this.canvas.width = outputWidth
      this.canvas.height = outputHeight
      this.imageData = null
    }
    if (!this.imageData) this.imageData = this.context.createImageData(outputWidth, outputHeight)
    const output = this.imageData.data
    const scale = Math.max(params.z2 - params.z1, 1e-20)
    for (let index = 0; index < outputWidth * outputHeight; index++) {
      let source: number
      if (params.alignment) {
        const x = index % outputWidth
        const y = Math.floor(index / outputWidth)
        const mapped = mapReferenceToSource(
          x,
          y,
          params.alignment.reference,
          params.alignment.source,
        )
        source = sampleBilinear(params.pixels, params.width, params.height, mapped.x, mapped.y)
      } else {
        source = params.pixels[index]
      }
      let value = Number.isFinite(source)
        ? Math.min(1, Math.max(0, (source - params.z1) / scale))
        : 0
      if (params.stretchMode === 'asinh') value = Math.asinh(value * 10) / Math.asinh(10)
      if (params.inverted) value = 1 - value
      const gray = Math.round(value * 255)
      const offset = index * 4
      output[offset] = gray
      output[offset + 1] = gray
      output[offset + 2] = gray
      output[offset + 3] = 255
    }
    this.context.putImageData(this.imageData, 0, 0)
  }

  diagnostics(): RendererDiagnostics {
    return {
      backend: 'canvas2d',
      bytes: this.imageData?.data.byteLength ?? 0,
      entries: this.imageData ? 1 : 0,
      evictions: 0,
      maxBytes: this.imageData?.data.byteLength ?? 0,
      fallbackReason: this.reason,
    }
  }

  dispose() {
    this.disposed = true
    this.imageData = null
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }
}

function mapReferenceToSource(
  x: number,
  y: number,
  reference: AlignmentWcs,
  source: AlignmentWcs,
): { x: number; y: number } {
  const dx = x - reference.crpix1
  const dy = y - reference.crpix2
  const xi = ((reference.cd1_1 * dx + reference.cd1_2 * dy) * Math.PI) / 180
  const eta = ((reference.cd2_1 * dx + reference.cd2_2 * dy) * Math.PI) / 180
  const ra0 = (reference.crval1 * Math.PI) / 180
  const dec0 = (reference.crval2 * Math.PI) / 180
  const denominator = Math.cos(dec0) - eta * Math.sin(dec0)
  const ra = ra0 + Math.atan2(xi, denominator)
  const dec = Math.atan2(Math.sin(dec0) + eta * Math.cos(dec0), Math.hypot(denominator, xi))
  const sourceRa = (source.crval1 * Math.PI) / 180
  const sourceDec = (source.crval2 * Math.PI) / 180
  const dra = ra - sourceRa
  const projection =
    Math.sin(dec) * Math.sin(sourceDec) + Math.cos(dec) * Math.cos(sourceDec) * Math.cos(dra)
  if (projection <= 0) return { x: Number.NaN, y: Number.NaN }
  const sourceXi = ((Math.cos(dec) * Math.sin(dra)) / projection) * (180 / Math.PI)
  const sourceEta =
    ((Math.sin(dec) * Math.cos(sourceDec) - Math.cos(dec) * Math.sin(sourceDec) * Math.cos(dra)) /
      projection) *
    (180 / Math.PI)
  const determinant = source.cd1_1 * source.cd2_2 - source.cd1_2 * source.cd2_1
  return {
    x: source.crpix1 + (source.cd2_2 * sourceXi - source.cd1_2 * sourceEta) / determinant,
    y: source.crpix2 + (-source.cd2_1 * sourceXi + source.cd1_1 * sourceEta) / determinant,
  }
}

function sampleBilinear(
  pixels: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x >= width - 1 ||
    y >= height - 1
  ) {
    return Number.NaN
  }
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const top = pixels[y0 * width + x0] * (1 - fx) + pixels[y0 * width + x0 + 1] * fx
  const bottom = pixels[(y0 + 1) * width + x0] * (1 - fx) + pixels[(y0 + 1) * width + x0 + 1] * fx
  return top * (1 - fy) + bottom * fy
}

export function createFrameRenderer(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  onContextRestored: () => void,
): FrameRenderer {
  const probe = document.createElement('canvas')
  const gl = probe.getContext('webgl2')
  if (!gl) return new CanvasFITSRenderer(canvas, 'WebGL2 不可用')
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  if (width > maxTextureSize || height > maxTextureSize) {
    return new CanvasFITSRenderer(
      canvas,
      `图像 ${width}×${height} 超过 WebGL MAX_TEXTURE_SIZE=${maxTextureSize}`,
    )
  }
  return new FITSRenderer(canvas, onContextRestored)
}
