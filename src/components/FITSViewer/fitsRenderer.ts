/**
 * FITSRenderer —— 非 React 的 WebGL2 渲染引擎。
 *
 * 生命周期独立于当前帧:编译/链接 shader 一次、纹理按 `sequenceId:frameIndex`
 * 缓存,播放热路径只做 bindTexture + setUniforms + drawArrays,零上传、零编译。
 * 适用工作负载为固定小工作集(BlinkSet,通常 2/4 帧),不做通用 LRU。
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
}

interface TextureEntry {
  texture: WebGLTexture
  width: number
  height: number
}

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
  in vec2 uv;
  out vec4 color;
  void main() {
    float source = texture(image, vec2(uv.x, 1.0 - uv.y)).r;
    float value = clamp((source - blackPoint) / max(whitePoint - blackPoint, 1.0e-20), 0.0, 1.0);
    if (useAsinh) value = asinh(value * 10.0) / asinh(10.0);
    if (inverted) value = 1.0 - value;
    if (isnan(source) || isinf(source)) value = inverted ? 1.0 : 0.0;
    color = vec4(value, value, value, 1.0);
  }`

export class FITSRenderer {
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
  }
  private lostHandler: (event: Event) => void
  private restoredHandler: () => void
  private disposed = false

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
    }

    gl.useProgram(program)
    gl.activeTexture(gl.TEXTURE0)
    gl.uniform1i(this.uniforms.image, 0)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

    // context lost:只清空 JS 侧缓存,不调用任何 GL 删除(context 已失效)
    this.lostHandler = (event) => {
      event.preventDefault()
      this.textures.clear()
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
    if (canvas.width !== params.width || canvas.height !== params.height) {
      canvas.width = params.width
      canvas.height = params.height
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
    }
    const entry = this.ensureTexture(params.key, params.pixels, params.width, params.height)
    gl.bindTexture(gl.TEXTURE_2D, entry.texture)
    gl.useProgram(this.program)
    gl.uniform1f(this.uniforms.blackPoint, params.z1)
    gl.uniform1f(this.uniforms.whitePoint, params.z2)
    gl.uniform1i(this.uniforms.useAsinh, params.stretchMode === 'asinh' ? 1 : 0)
    gl.uniform1i(this.uniforms.inverted, params.inverted ? 1 : 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
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
    gl.deleteProgram(this.program)
  }

  private ensureTexture(
    key: string,
    pixels: Float32Array,
    width: number,
    height: number,
  ): TextureEntry {
    const existing = this.textures.get(key)
    if (existing) return existing
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
    const entry: TextureEntry = { texture, width, height }
    this.textures.set(key, entry)
    return entry
  }
}
