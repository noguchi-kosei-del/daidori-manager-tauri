use serde::Serialize;
use serde_json::Value;
use std::env;
use std::fs;
use std::io::{self, Cursor};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::Instant;
use tauri::{AppHandle, Manager};
use zip::ZipArchive;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const EPUBCHECK_VERSION: &str = "5.3.0";
const EPUBCHECK_DOWNLOAD_URL: &str =
    "https://github.com/w3c/epubcheck/releases/download/v5.3.0/epubcheck-5.3.0.zip";
const JAVA_VERSION_DIR: &str = "temurin-21";
const JAVA_DOWNLOAD_URL: &str =
    "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubCheckMessage {
    pub severity: String,
    pub code: Option<String>,
    pub message: String,
    pub path: Option<String>,
    pub line: Option<u64>,
    pub column: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubCheckResult {
    pub available: bool,
    pub is_valid: bool,
    pub checked_path: String,
    pub checker_version: Option<String>,
    pub elapsed_ms: u128,
    pub fatal_count: usize,
    pub error_count: usize,
    pub warning_count: usize,
    pub usage_count: usize,
    pub info_count: usize,
    pub messages: Vec<EpubCheckMessage>,
    pub raw_output: Option<String>,
    pub error: Option<String>,
}

enum EpubCheckRunner {
    Command(PathBuf),
    Jar {
        java_path: PathBuf,
        jar_path: PathBuf,
    },
}

impl EpubCheckRunner {
    fn label(&self) -> String {
        match self {
            EpubCheckRunner::Command(path) => path.display().to_string(),
            EpubCheckRunner::Jar {
                java_path,
                jar_path,
            } => format!("{} -jar {}", java_path.display(), jar_path.display()),
        }
    }

    fn run(&self, epub_path: &str) -> io::Result<Output> {
        match self {
            EpubCheckRunner::Command(path) => {
                let mut command = Command::new(path);
                configure_hidden_command(&mut command);
                command.args(["--json", "-", epub_path]).output()
            }
            EpubCheckRunner::Jar {
                java_path,
                jar_path,
            } => {
                let mut command = Command::new(java_path);
                configure_hidden_command(&mut command);
                if let Some(jar_dir) = jar_path.parent() {
                    command.current_dir(jar_dir);
                }
                command
                    .arg("-Dfile.encoding=UTF-8")
                    .arg("-Dsun.stdout.encoding=UTF-8")
                    .arg("-Dsun.stderr.encoding=UTF-8")
                    .arg("-jar")
                    .arg(jar_path)
                    .args(["--json", "-", epub_path])
                    .output()
            }
        }
    }
}

fn configure_hidden_command(command: &mut Command) {
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

#[tauri::command]
pub async fn validate_epub_with_epubcheck(
    app_handle: AppHandle,
    epub_path: String,
) -> Result<EpubCheckResult, String> {
    if !Path::new(&epub_path).exists() {
        return Err(format!("EPUBファイルが見つかりません: {}", epub_path));
    }

    tokio::task::spawn_blocking(move || validate_epub_sync(&app_handle, epub_path))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

fn validate_epub_sync(
    app_handle: &AppHandle,
    epub_path: String,
) -> Result<EpubCheckResult, String> {
    let started = Instant::now();
    let mut setup_errors = Vec::new();
    let managed_tools = match ensure_managed_tools(app_handle) {
        Ok(tools) => Some(tools),
        Err(error) => {
            setup_errors.push(error);
            None
        }
    };
    let runners = find_epubcheck_runners(app_handle, managed_tools.as_ref());

    let mut run_errors = setup_errors;
    for runner in runners {
        match runner.run(&epub_path) {
            Ok(output) => {
                if !has_json_report(&output) {
                    run_errors.push(format!("{}: {}", runner.label(), output_summary(&output)));
                    continue;
                }
                let elapsed_ms = started.elapsed().as_millis();
                return Ok(parse_epubcheck_output(epub_path, output, elapsed_ms));
            }
            Err(error) => run_errors.push(format!("{}: {}", runner.label(), error)),
        }
    }

    Ok(unavailable_result(
        epub_path,
        started.elapsed().as_millis(),
        run_errors.join("\n"),
    ))
}

struct ManagedTools {
    java_path: PathBuf,
    jar_path: PathBuf,
}

fn ensure_managed_tools(app_handle: &AppHandle) -> Result<ManagedTools, String> {
    let tools_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("アプリ管理フォルダを取得できませんでした: {}", e))?
        .join("tools");
    let java_dir = tools_dir.join("java").join(JAVA_VERSION_DIR);
    let epubcheck_dir = tools_dir
        .join("epubcheck")
        .join(format!("epubcheck-{}", EPUBCHECK_VERSION));

    let java_path = find_java_executable(&java_dir).unwrap_or_else(|| {
        java_dir
            .join("bin")
            .join(if cfg!(windows) { "java.exe" } else { "java" })
    });
    let jar_path = epubcheck_dir.join("epubcheck.jar");

    if !java_path.exists() {
        download_and_extract_zip(JAVA_DOWNLOAD_URL, &java_dir, true)
            .map_err(|e| format!("Javaランタイムの準備に失敗しました: {}", e))?;
    }
    if !jar_path.exists() {
        download_and_extract_zip(EPUBCHECK_DOWNLOAD_URL, &epubcheck_dir, true)
            .map_err(|e| format!("EPUBCheckの準備に失敗しました: {}", e))?;
    }

    let java_path = find_java_executable(&java_dir).ok_or_else(|| {
        "Javaランタイムを展開しましたが java.exe が見つかりませんでした".to_string()
    })?;
    let jar_path = find_epubcheck_jar(&epubcheck_dir).ok_or_else(|| {
        "EPUBCheckを展開しましたが epubcheck.jar が見つかりませんでした".to_string()
    })?;

    Ok(ManagedTools {
        java_path,
        jar_path,
    })
}

fn download_and_extract_zip(
    url: &str,
    destination: &Path,
    strip_single_root: bool,
) -> Result<(), String> {
    let temp_destination = destination.with_extension("download");
    if temp_destination.exists() {
        fs::remove_dir_all(&temp_destination).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&temp_destination).map_err(|e| e.to_string())?;

    let response = reqwest::blocking::get(url)
        .and_then(|response| response.error_for_status())
        .map_err(|e| e.to_string())?;
    let bytes = response.bytes().map_err(|e| e.to_string())?;

    extract_zip_bytes(bytes.as_ref(), &temp_destination, strip_single_root)?;

    if destination.exists() {
        fs::remove_dir_all(destination).map_err(|e| e.to_string())?;
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&temp_destination, destination).map_err(|e| e.to_string())?;
    Ok(())
}

fn extract_zip_bytes(
    bytes: &[u8],
    destination: &Path,
    strip_single_root: bool,
) -> Result<(), String> {
    let reader = Cursor::new(bytes);
    let mut archive = ZipArchive::new(reader).map_err(|e| e.to_string())?;
    let root_prefix = if strip_single_root {
        find_single_zip_root(&mut archive)?
    } else {
        None
    };

    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|e| e.to_string())?;
        let Some(enclosed_name) = file.enclosed_name().map(|path| path.to_path_buf()) else {
            continue;
        };
        let relative_path = if let Some(root) = &root_prefix {
            match enclosed_name.strip_prefix(root) {
                Ok(path) if !path.as_os_str().is_empty() => path.to_path_buf(),
                _ => continue,
            }
        } else {
            enclosed_name
        };
        let output_path = destination.join(relative_path);

        if file.is_dir() {
            fs::create_dir_all(&output_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = output_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut output = fs::File::create(&output_path).map_err(|e| e.to_string())?;
            io::copy(&mut file, &mut output).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn find_single_zip_root(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
) -> Result<Option<PathBuf>, String> {
    let mut root: Option<PathBuf> = None;
    for index in 0..archive.len() {
        let file = archive.by_index(index).map_err(|e| e.to_string())?;
        let Some(path) = file.enclosed_name().map(|path| path.to_path_buf()) else {
            continue;
        };
        let Some(first) = path.components().next() else {
            continue;
        };
        let first = PathBuf::from(first.as_os_str());
        match &root {
            Some(existing) if existing != &first => return Ok(None),
            None => root = Some(first),
            _ => {}
        }
    }
    Ok(root)
}

fn find_epubcheck_runners(
    app_handle: &AppHandle,
    managed_tools: Option<&ManagedTools>,
) -> Vec<EpubCheckRunner> {
    let mut runners = Vec::new();

    if let Some(tools) = managed_tools {
        runners.push(EpubCheckRunner::Jar {
            java_path: tools.java_path.clone(),
            jar_path: tools.jar_path.clone(),
        });
    }

    if let Ok(path) = env::var("EPUBCHECK_PATH") {
        push_runner_for_path(&mut runners, PathBuf::from(path));
    }
    if let Ok(path) = env::var("EPUBCHECK_JAR") {
        let path = PathBuf::from(path);
        if path.exists() {
            runners.push(EpubCheckRunner::Jar {
                java_path: PathBuf::from("java"),
                jar_path: path,
            });
        }
    }

    for jar_path in find_legacy_resource_epubcheck_jars(app_handle) {
        runners.push(EpubCheckRunner::Jar {
            java_path: PathBuf::from("java"),
            jar_path,
        });
    }

    runners.push(EpubCheckRunner::Command(PathBuf::from("epubcheck")));
    runners
}

fn push_runner_for_path(runners: &mut Vec<EpubCheckRunner>, path: PathBuf) {
    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("jar"))
    {
        if path.exists() {
            runners.push(EpubCheckRunner::Jar {
                java_path: PathBuf::from("java"),
                jar_path: path,
            });
        }
    } else {
        runners.push(EpubCheckRunner::Command(path));
    }
}

fn find_java_executable(root: &Path) -> Option<PathBuf> {
    let java_name = if cfg!(windows) { "java.exe" } else { "java" };
    collect_file_by_name(root, java_name, 5).into_iter().next()
}

fn find_epubcheck_jar(root: &Path) -> Option<PathBuf> {
    collect_file_by_name(root, "epubcheck.jar", 5)
        .into_iter()
        .next()
}

fn find_legacy_resource_epubcheck_jars(app_handle: &AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        roots.push(resource_dir.join("resources").join("epubcheck"));
        roots.push(resource_dir.join("epubcheck"));
    }
    collect_files_in_roots(roots, "epubcheck.jar", 3)
}

fn collect_files_in_roots(roots: Vec<PathBuf>, name: &str, max_depth: usize) -> Vec<PathBuf> {
    roots
        .into_iter()
        .flat_map(|root| collect_file_by_name(&root, name, max_depth))
        .collect()
}

fn collect_file_by_name(dir: &Path, name: &str, max_depth: usize) -> Vec<PathBuf> {
    let mut files = Vec::new();
    collect_file_by_name_inner(dir, name, max_depth, 0, &mut files);
    files
}

fn collect_file_by_name_inner(
    dir: &Path,
    name: &str,
    max_depth: usize,
    depth: usize,
    files: &mut Vec<PathBuf>,
) {
    if depth > max_depth || !dir.exists() {
        return;
    }

    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_file_by_name_inner(&path, name, max_depth, depth + 1, files);
        } else if path
            .file_name()
            .and_then(|file_name| file_name.to_str())
            .is_some_and(|file_name| file_name.eq_ignore_ascii_case(name))
        {
            files.push(path);
        }
    }
}

fn unavailable_result(checked_path: String, elapsed_ms: u128, details: String) -> EpubCheckResult {
    let error = if details.trim().is_empty() {
        "EPUBCheckの準備または実行ができませんでした。ネットワーク接続を確認してから再度お試しください。"
            .to_string()
    } else {
        format!("EPUBCheckの準備または実行ができませんでした。\n{}", details)
    };

    EpubCheckResult {
        available: false,
        is_valid: false,
        checked_path,
        checker_version: None,
        elapsed_ms,
        fatal_count: 0,
        error_count: 0,
        warning_count: 0,
        usage_count: 0,
        info_count: 0,
        messages: Vec::new(),
        raw_output: None,
        error: Some(error),
    }
}

fn has_json_report(output: &Output) -> bool {
    serde_json::from_slice::<Value>(&output.stdout).is_ok()
        || serde_json::from_slice::<Value>(&output.stderr).is_ok()
}

fn output_summary(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("終了コード {:?}", output.status.code())
    }
}

fn parse_epubcheck_output(
    checked_path: String,
    output: Output,
    elapsed_ms: u128,
) -> EpubCheckResult {
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let raw_output = if stdout.trim().is_empty() {
        stderr.clone()
    } else {
        stdout.clone()
    };

    let parsed =
        serde_json::from_str::<Value>(&stdout).or_else(|_| serde_json::from_str::<Value>(&stderr));

    let Ok(report) = parsed else {
        let message = stderr
            .lines()
            .chain(stdout.lines())
            .find(|line| !line.trim().is_empty())
            .unwrap_or("EPUBCheckの結果を解析できませんでした")
            .to_string();

        return EpubCheckResult {
            available: false,
            is_valid: false,
            checked_path,
            checker_version: None,
            elapsed_ms,
            fatal_count: 0,
            error_count: 0,
            warning_count: 0,
            usage_count: 0,
            info_count: 0,
            messages: Vec::new(),
            raw_output: Some(raw_output),
            error: Some(format!(
                "EPUBCheckの結果を解析できませんでした。\n{}",
                message
            )),
        };
    };

    let messages = report
        .get("messages")
        .and_then(Value::as_array)
        .map(|items| items.iter().map(parse_message).collect::<Vec<_>>())
        .unwrap_or_default();

    let checker = report.get("checker");
    let fatal_count = checker
        .and_then(|checker| get_usize(checker, &["nFatal", "fatalCount"]))
        .unwrap_or_else(|| count_severity(&messages, "FATAL"));
    let error_count = checker
        .and_then(|checker| get_usize(checker, &["nError", "errorCount"]))
        .unwrap_or_else(|| count_severity(&messages, "ERROR"));
    let warning_count = checker
        .and_then(|checker| get_usize(checker, &["nWarning", "warningCount"]))
        .unwrap_or_else(|| count_severity(&messages, "WARNING"));
    let usage_count = checker
        .and_then(|checker| get_usize(checker, &["nUsage", "usageCount"]))
        .unwrap_or_else(|| count_severity(&messages, "USAGE"));
    let info_count = messages
        .iter()
        .filter(|message| matches!(message.severity.as_str(), "INFO" | "HINT"))
        .count();

    let checker_version = checker.and_then(|checker| {
        get_string(checker, &["version", "epubcheckVersion", "checkerVersion"])
    });

    EpubCheckResult {
        available: true,
        is_valid: fatal_count == 0 && error_count == 0 && output.status.success(),
        checked_path,
        checker_version,
        elapsed_ms,
        fatal_count,
        error_count,
        warning_count,
        usage_count,
        info_count,
        messages,
        raw_output: Some(raw_output),
        error: None,
    }
}

fn parse_message(value: &Value) -> EpubCheckMessage {
    let severity = get_string(value, &["severity", "type", "level"])
        .map(|severity| severity.to_uppercase())
        .unwrap_or_else(|| "INFO".to_string());
    let code = get_string(value, &["ID", "id", "code", "messageId", "subMessage"]);
    let message =
        get_string(value, &["message", "text", "description"]).unwrap_or_else(|| value.to_string());

    let location = value
        .get("locations")
        .and_then(Value::as_array)
        .and_then(|locations| locations.first())
        .or_else(|| value.get("location"));

    let path = location
        .and_then(|location| get_string(location, &["path", "file", "resource"]))
        .or_else(|| get_string(value, &["path", "file", "resource"]));
    let line = location
        .and_then(|location| get_u64(location, &["line", "row"]))
        .or_else(|| get_u64(value, &["line", "row"]));
    let column = location
        .and_then(|location| get_u64(location, &["column", "col"]))
        .or_else(|| get_u64(value, &["column", "col"]));

    EpubCheckMessage {
        severity,
        code,
        message,
        path,
        line,
        column,
    }
}

fn get_string(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(text) = value.get(*key).and_then(Value::as_str) {
            return Some(text.to_string());
        }
    }
    None
}

fn get_u64(value: &Value, keys: &[&str]) -> Option<u64> {
    for key in keys {
        if let Some(number) = value.get(*key).and_then(Value::as_u64) {
            return Some(number);
        }
    }
    None
}

fn get_usize(value: &Value, keys: &[&str]) -> Option<usize> {
    get_u64(value, keys).map(|number| number as usize)
}

fn count_severity(messages: &[EpubCheckMessage], severity: &str) -> usize {
    messages
        .iter()
        .filter(|message| message.severity == severity)
        .count()
}
