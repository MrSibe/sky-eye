use log::{Level, LevelFilter, Log, Metadata, Record};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime},
};
use time::{format_description::well_known::Rfc3339, OffsetDateTime, UtcOffset};

const DIAGNOSTIC_RETENTION_DAYS: u64 = 14;
const SESSION_RETENTION_DAYS: u64 = 90;

struct LogState {
    date: String,
    file: File,
}

struct FileLogger {
    logs_dir: PathBuf,
    state: Mutex<LogState>,
    level: LevelFilter,
}

impl Log for FileLogger {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        metadata.level() <= self.level
    }

    fn log(&self, record: &Record<'_>) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let now = local_now();
        let date = now.date().to_string();
        let timestamp = format_timestamp(now);
        let target = record.module_path().unwrap_or(record.target());
        let line = format!(
            "{timestamp} {:<5} {target} - {}\n",
            record.level(),
            record.args()
        );

        if let Ok(mut state) = self.state.lock() {
            if state.date != date {
                if let Ok(file) = open_diagnostic_file(&self.logs_dir, &date) {
                    state.date = date;
                    state.file = file;
                }
            }
            let _ = state.file.write_all(line.as_bytes());
            let _ = state.file.flush();
        }

        #[cfg(debug_assertions)]
        {
            let _ = io::stderr().write_all(line.as_bytes());
        }
    }

    fn flush(&self) {
        if let Ok(mut state) = self.state.lock() {
            let _ = state.file.flush();
        }
    }
}

pub fn initialize(logs_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(logs_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(logs_dir.join("sessions")).map_err(|error| error.to_string())?;
    cleanup_old_logs(logs_dir, DIAGNOSTIC_RETENTION_DAYS, false);
    cleanup_old_logs(&logs_dir.join("sessions"), SESSION_RETENTION_DAYS, true);

    let date = local_now().date().to_string();
    let file = open_diagnostic_file(logs_dir, &date).map_err(|error| error.to_string())?;
    let level = if cfg!(debug_assertions) {
        LevelFilter::Debug
    } else {
        LevelFilter::Info
    };
    log::set_boxed_logger(Box::new(FileLogger {
        logs_dir: logs_dir.to_path_buf(),
        state: Mutex::new(LogState { date, file }),
        level,
    }))
    .map_err(|error| error.to_string())?;
    log::set_max_level(level);
    install_panic_hook();
    Ok(())
}

fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|value| format!("{}:{}", value.file(), value.line()))
            .unwrap_or_else(|| "unknown location".to_string());
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(String::as_str))
            .unwrap_or("non-string panic payload");
        log::error!(target: "panic", "panic at {location}: {message}");
        previous(info);
    }));
}

fn open_diagnostic_file(logs_dir: &Path, date: &str) -> io::Result<File> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(logs_dir.join(format!("sky-eye-{date}.log")))
}

fn cleanup_old_logs(directory: &Path, retention_days: u64, include_all_logs: bool) {
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(retention_days * 24 * 60 * 60))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let matches_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                name.ends_with(".log") && (include_all_logs || name.starts_with("sky-eye-"))
            });
        if !matches_name {
            continue;
        }
        let is_old = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .is_ok_and(|modified| modified < cutoff);
        if is_old {
            let _ = fs::remove_file(path);
        }
    }
}

pub struct ReductionSessionLog {
    run_id: String,
    path: PathBuf,
    file: File,
    finished: bool,
}

impl ReductionSessionLog {
    pub fn create(logs_dir: &Path, run_id: &str) -> Result<Self, String> {
        let sessions_dir = logs_dir.join("sessions");
        fs::create_dir_all(&sessions_dir).map_err(|error| error.to_string())?;
        let now = local_now();
        let stamp = format!(
            "{}T{:02}{:02}{:02}",
            now.date(),
            now.hour(),
            now.minute(),
            now.second()
        );
        let path = sessions_dir.join(format!("reduction-{stamp}-{run_id}.log"));
        let file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
            .map_err(|error| error.to_string())?;
        Ok(Self {
            run_id: run_id.to_string(),
            path,
            file,
            finished: false,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn line(&mut self, level: Level, section: &str, message: impl AsRef<str>) {
        let timestamp = format_timestamp(local_now());
        let _ = writeln!(
            self.file,
            "{timestamp} {:<5} [{section}] {}",
            level,
            message.as_ref()
        );
        let _ = self.file.flush();
    }

    pub fn raw(&mut self, message: impl AsRef<str>) {
        let _ = writeln!(self.file, "{}", message.as_ref());
        let _ = self.file.flush();
    }

    pub fn finish(&mut self, status: &str, summary: impl AsRef<str>) {
        self.line(
            Level::Info,
            "end",
            format!("status={status} {}", summary.as_ref()),
        );
        self.finished = true;
    }
}

impl Drop for ReductionSessionLog {
    fn drop(&mut self) {
        if !self.finished {
            self.line(
                Level::Error,
                "end",
                format!("status=aborted run_id={}", self.run_id),
            );
        }
    }
}

fn local_now() -> OffsetDateTime {
    let utc = OffsetDateTime::now_utc();
    UtcOffset::current_local_offset()
        .map(|offset| utc.to_offset(offset))
        .unwrap_or(utc)
}

fn format_timestamp(value: OffsetDateTime) -> String {
    value
        .format(&Rfc3339)
        .unwrap_or_else(|_| value.unix_timestamp().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reduction_session_log_is_utf8_and_records_completion() {
        let root =
            std::env::temp_dir().join(format!("sky-eye-session-log-test-{}", uuid::Uuid::new_v4()));
        let path = {
            let mut session = ReductionSessionLog::create(&root, "test-run").unwrap();
            let path = session.path().to_path_buf();
            session.line(Level::Info, "frame 1/1 detection", "提取星点：42");
            session.finish("completed", "solved=1 failed=0");
            path
        };
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("提取星点：42"));
        assert!(content.contains("status=completed"));
        fs::remove_dir_all(root).unwrap();
    }
}
