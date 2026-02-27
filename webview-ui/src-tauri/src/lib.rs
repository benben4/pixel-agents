use arboard::Clipboard;
use dirs::home_dir;
use regex::Regex;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{LogicalSize, Size, State, WebviewWindow};
use walkdir::WalkDir;

const IDLE_AFTER_MS: i64 = 20_000;
const DONE_AFTER_MS: i64 = 90_000;
const CODEX_TAIL_BYTES: usize = 65_536;
const MAX_CODEX_FILES: usize = 120;
const MAX_OPENCODE_FILES: usize = 800;
const MAX_OPENCODE_PART_FILES: usize = 900;
const MAX_OPENCODE_DB_SESSIONS: usize = 800;
const MAX_OPENCODE_DB_PARTS: usize = 1500;
const MAX_MONITOR_TEXT_CHARS: usize = 180;
const PIP_WINDOW_WIDTH_PX: f64 = 560.0;
const PIP_WINDOW_HEIGHT_PX: f64 = 360.0;

#[derive(Clone, Copy)]
struct PipWindowState {
    logical_width: f64,
    logical_height: f64,
    always_on_top: bool,
}

#[derive(Default)]
struct AppState {
    previous_states: Mutex<HashMap<String, String>>,
    pip_window_state: Mutex<Option<PipWindowState>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MonitorSettings {
    enabled: bool,
    #[serde(rename = "enableClaude", default = "default_enable_claude")]
    enable_claude: bool,
    #[serde(rename = "enableOpencode")]
    enable_opencode: bool,
    #[serde(rename = "enableCodex")]
    enable_codex: bool,
    #[serde(rename = "enableGit")]
    enable_git: bool,
    #[serde(rename = "enablePr")]
    enable_pr: bool,
    #[serde(rename = "flushIntervalMs")]
    flush_interval_ms: i64,
    #[serde(rename = "sourcePollIntervalMs")]
    source_poll_interval_ms: i64,
    #[serde(rename = "gitPollIntervalMs")]
    git_poll_interval_ms: i64,
    #[serde(rename = "prPollIntervalMs")]
    pr_poll_interval_ms: i64,
    #[serde(rename = "agentLabelFontPx", default = "default_agent_label_font_px")]
    agent_label_font_px: i64,
    #[serde(rename = "maxIdleAgents", default = "default_max_idle_agents")]
    max_idle_agents: i64,
}

impl Default for MonitorSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            enable_claude: default_enable_claude(),
            enable_opencode: true,
            enable_codex: true,
            enable_git: true,
            enable_pr: true,
            flush_interval_ms: 1000,
            source_poll_interval_ms: 2000,
            git_poll_interval_ms: 20000,
            pr_poll_interval_ms: 90000,
            agent_label_font_px: default_agent_label_font_px(),
            max_idle_agents: default_max_idle_agents(),
        }
    }
}

fn default_enable_claude() -> bool {
    true
}

fn default_agent_label_font_px() -> i64 {
    24
}

fn default_max_idle_agents() -> i64 {
    3
}

#[derive(Debug, Clone, Serialize)]
struct MonitorAlert {
    kind: String,
    message: String,
    ts_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
struct MonitorEventView {
    ts_ms: i64,
    #[serde(rename = "type")]
    event_type: String,
    state_hint: String,
    text: Option<String>,
    files_touched: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct MonitorAgentView {
    key: String,
    source: String,
    session_id: String,
    agent_id: String,
    display_name: String,
    state: String,
    last_ts_ms: i64,
    last_text: Option<String>,
    repo_path: Option<String>,
    files_touched: Vec<String>,
    alerts: Vec<MonitorAlert>,
    recent_events: Vec<MonitorEventView>,
}

#[derive(Debug, Clone, Serialize)]
struct MonitorSummary {
    total: usize,
    active: usize,
    waiting: usize,
    done: usize,
    error: usize,
    pr_pending: usize,
    alerts: usize,
}

#[derive(Debug, Clone, Serialize)]
struct MonitorSnapshot {
    summary: MonitorSummary,
    agents: Vec<MonitorAgentView>,
    now_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
struct MonitorNotification {
    title: String,
    message: String,
    kind: String,
    key: String,
}

#[derive(Debug, Clone, Serialize)]
struct MonitorTickPayload {
    snapshot: MonitorSnapshot,
    notifications: Vec<MonitorNotification>,
}

#[derive(Debug, Clone, Serialize)]
struct BootstrapPayload {
    layout: Value,
    #[serde(rename = "soundEnabled")]
    sound_enabled: bool,
    #[serde(rename = "demoMode")]
    demo_mode: bool,
    #[serde(rename = "monitorSettings")]
    monitor_settings: MonitorSettings,
    #[serde(rename = "claudeAvailable")]
    claude_available: bool,
}

#[derive(Debug, Clone)]
struct AgentTemp {
    key: String,
    source: String,
    session_id: String,
    agent_name: Option<String>,
    state: String,
    last_ts_ms: i64,
    last_text: Option<String>,
    repo_path: Option<String>,
    recent_events: Vec<MonitorEventView>,
}

#[tauri::command]
fn desktop_bootstrap() -> Result<BootstrapPayload, String> {
    Ok(BootstrapPayload {
        layout: read_layout_or_default()?,
        sound_enabled: read_sound_enabled(),
        demo_mode: read_demo_mode(),
        monitor_settings: read_monitor_settings(),
        claude_available: claude_available(),
    })
}

#[tauri::command]
fn desktop_save_layout(layout: Value) -> Result<(), String> {
    write_json_file(&layout_file(), &layout)
}

#[tauri::command]
fn desktop_read_layout() -> Result<Value, String> {
    read_layout_or_default()
}

#[tauri::command]
fn desktop_save_agent_seats(seats: Value) -> Result<(), String> {
    write_json_file(&agent_seats_file(), &seats)
}

#[tauri::command]
fn desktop_set_monitor_settings(settings: MonitorSettings) -> Result<(), String> {
    write_json_file(
        &monitor_settings_file(),
        &serde_json::to_value(settings).map_err(|e| e.to_string())?,
    )
}

#[tauri::command]
fn desktop_set_sound_enabled(enabled: bool) -> Result<(), String> {
    write_desktop_setting_bool("soundEnabled", enabled)
}

#[tauri::command]
fn desktop_set_demo_mode(enabled: bool) -> Result<(), String> {
    write_desktop_setting_bool("demoMode", enabled)
}

#[tauri::command]
fn desktop_set_picture_in_picture(
    state: State<AppState>,
    window: WebviewWindow,
    enabled: bool,
) -> Result<(), String> {
    if enabled {
        let mut lock = state
            .pip_window_state
            .lock()
            .map_err(|_| "pip window state lock failed".to_string())?;
        if lock.is_none() {
            let size = window.inner_size().map_err(|e| e.to_string())?;
            let scale_factor = window.scale_factor().map_err(|e| e.to_string())?;
            let always_on_top = window.is_always_on_top().map_err(|e| e.to_string())?;
            *lock = Some(PipWindowState {
                logical_width: f64::from(size.width) / scale_factor,
                logical_height: f64::from(size.height) / scale_factor,
                always_on_top,
            });
        }
        drop(lock);
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        window
            .set_size(Size::Logical(LogicalSize::new(
                PIP_WINDOW_WIDTH_PX,
                PIP_WINDOW_HEIGHT_PX,
            )))
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let previous = {
        let mut lock = state
            .pip_window_state
            .lock()
            .map_err(|_| "pip window state lock failed".to_string())?;
        lock.take()
    };

    if let Some(previous) = previous {
        window
            .set_size(Size::Logical(LogicalSize::new(
                previous.logical_width,
                previous.logical_height,
            )))
            .map_err(|e| e.to_string())?;
        window
            .set_always_on_top(previous.always_on_top)
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    window.set_always_on_top(false).map_err(|e| e.to_string())
}

#[tauri::command]
fn desktop_bind_repo(source: String, session_id: String, repo_path: String) -> Result<(), String> {
    let mut bindings = read_repo_bindings();
    bindings.insert(format!("{}:{}", source, session_id), repo_path);
    write_json_file(
        &repo_bindings_file(),
        &serde_json::to_value(bindings).map_err(|e| e.to_string())?,
    )
}

#[tauri::command]
fn desktop_sessions_folder() -> Option<String> {
    let codex = codex_sessions_root();
    if codex.exists() {
        return Some(codex.to_string_lossy().into_owned());
    }
    let opencode = opencode_message_root();
    if opencode.exists() {
        return Some(opencode.to_string_lossy().into_owned());
    }
    None
}

#[tauri::command]
fn desktop_open_path(path: String) -> Result<(), String> {
    opener::open(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn desktop_open_url(url: String) -> Result<(), String> {
    opener::open(url).map_err(|e| e.to_string())
}

#[tauri::command]
fn desktop_launch_agent(source: String, cwd: Option<String>) -> Result<(), String> {
    let normalized = source.trim().to_lowercase();
    let command = match normalized.as_str() {
        "claude" => "claude",
        "opencode" => "opencode",
        "codex" => "codex",
        _ => return Err("Unknown agent source".to_string()),
    };

    let resolved_cwd = cwd
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            std::env::current_dir()
                .map(|path| path.to_string_lossy().into_owned())
                .unwrap_or_else(|_| ".".to_string())
        });

    #[cfg(target_os = "windows")]
    {
        if !command_available(command) {
            return Err(format!("Command `{}` not found in PATH", command));
        }

        let cwd = resolved_cwd.replace('"', "\\\"");
        let launch_cmd = format!("cd \"{}\" && {}", cwd, command);

        Command::new("cmd")
            .args(["/C", "start", "cmd", "/K", &launch_cmd])
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let escaped_cwd = resolved_cwd.replace('\\', "\\\\").replace('"', "\\\"");
        let launch_cmd = format!("cd \"{}\" && {}", escaped_cwd, command);
        let escaped_command = launch_cmd.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            "tell application \"Terminal\" to activate\ntell application \"Terminal\" to do script \"{}\"",
            escaped_command
        );
        Command::new("osascript")
            .args(["-e", &script])
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if !command_available(command) {
            return Err(format!("Command `{}` not found in PATH", command));
        }

        let cwd = resolved_cwd.replace('"', "\\\"");
        let launch_cmd = format!("cd \"{}\" && {}", cwd, command);

        let mut launched = false;
        for candidate in [
            vec![
                "x-terminal-emulator",
                "-e",
                "sh",
                "-lc",
                launch_cmd.as_str(),
            ],
            vec!["gnome-terminal", "--", "sh", "-lc", launch_cmd.as_str()],
            vec!["konsole", "-e", "sh", "-lc", launch_cmd.as_str()],
            vec!["xterm", "-e", "sh", "-lc", launch_cmd.as_str()],
        ] {
            let program = candidate[0];
            if !command_available(program) {
                continue;
            }
            let args: Vec<&str> = candidate[1..].to_vec();
            if Command::new(program).args(args).spawn().is_ok() {
                launched = true;
                break;
            }
        }
        if launched {
            return Ok(());
        }
        return Err("No supported terminal emulator found".to_string());
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform".to_string())
}

#[tauri::command]
fn desktop_choose_repo_folder() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn desktop_copy_text(text: String) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
fn desktop_export_layout() -> Result<(), String> {
    let save = rfd::FileDialog::new()
        .set_file_name("pixel-agents-layout.json")
        .save_file();
    if let Some(path) = save {
        let layout = read_layout_or_default()?;
        let text = serde_json::to_string_pretty(&layout).map_err(|e| e.to_string())?;
        fs::write(path, text).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn desktop_import_layout() -> Result<Option<Value>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("json", &["json"])
        .pick_file();
    let Some(path) = file else {
        return Ok(None);
    };
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let parsed: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if parsed.get("version").and_then(Value::as_i64) != Some(1) {
        return Err("Invalid layout version".to_string());
    }
    if !parsed.get("tiles").map(|v| v.is_array()).unwrap_or(false) {
        return Err("Invalid layout tiles".to_string());
    }
    write_json_file(&layout_file(), &parsed)?;
    Ok(Some(parsed))
}

#[tauri::command]
fn desktop_monitor_tick(state: State<AppState>) -> Result<MonitorTickPayload, String> {
    let settings = read_monitor_settings();
    if !settings.enabled {
        let snapshot = MonitorSnapshot {
            summary: MonitorSummary {
                total: 0,
                active: 0,
                waiting: 0,
                done: 0,
                error: 0,
                pr_pending: 0,
                alerts: 0,
            },
            agents: Vec::new(),
            now_ms: now_ms(),
        };
        return Ok(MonitorTickPayload {
            snapshot,
            notifications: Vec::new(),
        });
    }

    let mut map: HashMap<String, AgentTemp> = HashMap::new();
    if settings.enable_opencode {
        scan_opencode(&mut map);
    }
    if settings.enable_codex {
        scan_codex(&mut map);
    }

    map.retain(|_, agent| {
        let source = normalize_source_name(&agent.source);
        if source == "claude" {
            return settings.enable_claude;
        }
        true
    });

    let repo_bindings = read_repo_bindings();
    for agent in map.values_mut() {
        if agent.repo_path.is_none() {
            if let Some(path) = repo_bindings.get(&agent.key) {
                agent.repo_path = Some(path.clone());
            }
        }
    }

    let now = now_ms();
    let mut agents: Vec<MonitorAgentView> = map
        .into_values()
        .map(|mut a| {
            let silence = now - a.last_ts_ms;
            if (a.state == "running" || a.state == "thinking" || a.state == "waiting")
                && silence > IDLE_AFTER_MS
            {
                a.state = "idle".to_string();
                if a.last_text.as_deref() == Some("Thinking") {
                    a.last_text = Some("Idle".to_string());
                }
            }
            if a.state == "idle" && silence > DONE_AFTER_MS {
                a.state = "done".to_string();
                if a.last_text.is_none()
                    || a.last_text.as_deref() == Some("Idle")
                    || a.last_text.as_deref() == Some("Thinking")
                {
                    a.last_text = Some("No recent activity".to_string());
                }
            }

            let alerts = if a.state == "error" {
                vec![MonitorAlert {
                    kind: "error".to_string(),
                    message: a
                        .last_text
                        .clone()
                        .unwrap_or_else(|| "Error detected".to_string()),
                    ts_ms: a.last_ts_ms,
                }]
            } else {
                Vec::new()
            };

            MonitorAgentView {
                key: a.key.clone(),
                source: normalize_source_name(&a.source),
                session_id: a.session_id.clone(),
                agent_id: a.session_id.clone(),
                display_name: format_agent_display_name(
                    &a.source,
                    &a.session_id,
                    a.agent_name.as_deref(),
                    a.repo_path.as_deref(),
                ),
                state: a.state.clone(),
                last_ts_ms: a.last_ts_ms,
                last_text: a.last_text.clone(),
                repo_path: a.repo_path.clone(),
                files_touched: Vec::new(),
                alerts,
                recent_events: a.recent_events.clone(),
            }
        })
        .collect();

    agents.sort_by(|a, b| b.last_ts_ms.cmp(&a.last_ts_ms));

    let summary = MonitorSummary {
        total: agents.len(),
        active: agents
            .iter()
            .filter(|a| a.state == "running" || a.state == "thinking")
            .count(),
        waiting: agents.iter().filter(|a| a.state == "waiting").count(),
        done: agents.iter().filter(|a| a.state == "done").count(),
        error: agents.iter().filter(|a| a.state == "error").count(),
        pr_pending: 0,
        alerts: agents.iter().map(|a| a.alerts.len()).sum(),
    };

    let snapshot = MonitorSnapshot {
        summary,
        agents: agents.clone(),
        now_ms: now,
    };

    let mut notifications = Vec::new();
    let mut lock = state
        .previous_states
        .lock()
        .map_err(|_| "state lock failed".to_string())?;
    let mut next_states: HashMap<String, String> = HashMap::new();
    for agent in &agents {
        next_states.insert(agent.key.clone(), agent.state.clone());
        if (agent.state == "done" || agent.state == "error")
            && lock.get(&agent.key) != Some(&agent.state)
        {
            notifications.push(MonitorNotification {
                title: if agent.state == "error" {
                    "Agent error".to_string()
                } else {
                    "Agent done".to_string()
                },
                message: format!(
                    "{} - {}",
                    agent.display_name,
                    agent.last_text.clone().unwrap_or_else(|| {
                        if agent.state == "error" {
                            "Error".to_string()
                        } else {
                            "Completed".to_string()
                        }
                    })
                ),
                kind: if agent.state == "error" {
                    "error".to_string()
                } else {
                    "done".to_string()
                },
                key: agent.key.clone(),
            });
        }
    }
    *lock = next_states;

    Ok(MonitorTickPayload {
        snapshot,
        notifications,
    })
}

fn normalize_source_name(source: &str) -> String {
    let normalized = source.trim().to_lowercase();
    if normalized == "claude"
        || normalized == "claude code"
        || normalized == "claude-code"
        || normalized == "claudecode"
    {
        return "claude".to_string();
    }
    if normalized == "opencode"
        || normalized == "open"
        || normalized == "open-code"
        || normalized == "open_code"
    {
        return "opencode".to_string();
    }
    if normalized == "codex" {
        return "codex".to_string();
    }
    source.to_string()
}

fn scan_opencode_db(map: &mut HashMap<String, AgentTemp>) -> bool {
    let db_path = opencode_db_file();
    if !db_path.exists() {
        return false;
    }

    let conn = match Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(c) => c,
        Err(_) => return false,
    };

    let mut session_repo: HashMap<String, String> = HashMap::new();
    let mut session_name: HashMap<String, String> = HashMap::new();

    {
        let mut stmt = match conn.prepare(
            "SELECT id, directory, title, time_updated
             FROM session
             WHERE time_archived IS NULL OR time_archived = 0
             ORDER BY time_updated DESC
             LIMIT ?1",
        ) {
            Ok(s) => s,
            Err(_) => return false,
        };

        let rows = stmt.query_map([MAX_OPENCODE_DB_SESSIONS as i64], |row| {
            let id: String = row.get(0)?;
            let directory: String = row.get(1)?;
            let title: Option<String> = row.get(2)?;
            let time_updated: i64 = row.get(3)?;
            Ok((id, directory, title, time_updated))
        });

        if let Ok(rows) = rows {
            for row in rows.flatten() {
                let (session_id, directory, title, time_updated) = row;
                let ts = normalize_epoch_ms(time_updated);
                session_repo.insert(session_id.clone(), directory.clone());
                if let Some(name) = title.clone() {
                    session_name.insert(session_id.clone(), name);
                }
                upsert_agent(
                    map,
                    AgentTemp {
                        key: format!("opencode:{}", session_id),
                        source: "opencode".to_string(),
                        session_id,
                        agent_name: title.clone(),
                        state: "running".to_string(),
                        last_ts_ms: ts,
                        last_text: Some("Session activity".to_string()),
                        repo_path: Some(directory),
                        recent_events: vec![MonitorEventView {
                            ts_ms: ts,
                            event_type: "status".to_string(),
                            state_hint: "running".to_string(),
                            text: Some("Session activity".to_string()),
                            files_touched: Vec::new(),
                        }],
                    },
                );
            }
        }
    }

    {
        let mut stmt = match conn.prepare(
            "SELECT session_id, time_updated, data
             FROM part
             ORDER BY time_updated DESC
             LIMIT ?1",
        ) {
            Ok(s) => s,
            Err(_) => return false,
        };

        let rows = stmt.query_map([MAX_OPENCODE_DB_PARTS as i64], |row| {
            let session_id: String = row.get(0)?;
            let time_updated: i64 = row.get(1)?;
            let data: String = row.get(2)?;
            Ok((session_id, time_updated, data))
        });

        if let Ok(rows) = rows {
            for row in rows.flatten() {
                let (session_id, time_updated, data) = row;
                let value: Value = match serde_json::from_str(&data) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let part_type = string_at(&value, &["type"]).unwrap_or_default();
                let fallback_ts = normalize_epoch_ms(time_updated);

                let (state, event_type, text, ts) = if part_type == "tool" {
                    let state_obj = value
                        .get("state")
                        .and_then(Value::as_object)
                        .cloned()
                        .unwrap_or_else(Map::new);
                    let status = state_obj
                        .get("status")
                        .and_then(Value::as_str)
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| "running".to_string());
                    let normalized_status = status.to_lowercase();
                    let tool_name =
                        string_at(&value, &["tool"]).unwrap_or_else(|| "tool".to_string());
                    let start_ts = state_obj
                        .get("time")
                        .and_then(Value::as_object)
                        .and_then(|t| t.get("start"))
                        .and_then(to_i64)
                        .map(normalize_epoch_ms)
                        .unwrap_or(fallback_ts);
                    let end_ts = state_obj
                        .get("time")
                        .and_then(Value::as_object)
                        .and_then(|t| t.get("end"))
                        .and_then(to_i64)
                        .map(normalize_epoch_ms);
                    let hint = if normalized_status == "error" {
                        "error".to_string()
                    } else if normalized_status == "completed" || end_ts.is_some() {
                        "done".to_string()
                    } else {
                        "running".to_string()
                    };
                    (
                        hint,
                        if normalized_status == "error" {
                            "error".to_string()
                        } else {
                            "tool".to_string()
                        },
                        Some(format!("{}: {}", tool_name, normalized_status)),
                        end_ts.unwrap_or(start_ts),
                    )
                } else if part_type == "reasoning" {
                    let start_ts = number_at(&value, &["time", "start"])
                        .map(normalize_epoch_ms)
                        .unwrap_or(fallback_ts);
                    let end_ts = number_at(&value, &["time", "end"]).map(normalize_epoch_ms);
                    (
                        "thinking".to_string(),
                        "status".to_string(),
                        string_at(&value, &["text"]).or_else(|| Some("Thinking".to_string())),
                        end_ts.unwrap_or(start_ts),
                    )
                } else if part_type == "step-start" {
                    (
                        "running".to_string(),
                        "status".to_string(),
                        Some("Step started".to_string()),
                        fallback_ts,
                    )
                } else if part_type == "step-finish" {
                    let reason =
                        string_at(&value, &["reason"]).unwrap_or_else(|| "stop".to_string());
                    (
                        "done".to_string(),
                        "status".to_string(),
                        Some(format!("Step finished: {}", reason)),
                        fallback_ts,
                    )
                } else {
                    continue;
                };

                let text = truncate_option_text(text);
                upsert_agent(
                    map,
                    AgentTemp {
                        key: format!("opencode:{}", session_id),
                        source: "opencode".to_string(),
                        session_id: session_id.clone(),
                        agent_name: session_name.get(&session_id).cloned(),
                        state: state.clone(),
                        last_ts_ms: ts,
                        last_text: text.clone(),
                        repo_path: session_repo.get(&session_id).cloned(),
                        recent_events: vec![MonitorEventView {
                            ts_ms: ts,
                            event_type,
                            state_hint: state,
                            text,
                            files_touched: Vec::new(),
                        }],
                    },
                );
            }
        }
    }

    true
}

fn scan_opencode(map: &mut HashMap<String, AgentTemp>) {
    if scan_opencode_db(map) {
        return;
    }

    let root = opencode_message_root();
    if !root.exists() {
        return;
    }

    let session_repo = load_opencode_session_repo_map();
    let session_name = load_opencode_session_name_map();

    let files = collect_files(&root, "json", MAX_OPENCODE_FILES);
    for file in files {
        let raw = match fs::read_to_string(&file) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let value: Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let session_id = string_at(&value, &["sessionID", "sessionId"])
            .or_else(|| {
                file.parent()
                    .and_then(|p| p.file_name())
                    .map(|s| s.to_string_lossy().into_owned())
            })
            .unwrap_or_else(|| "unknown".to_string());
        let key = format!("opencode:{}", session_id);
        let ts = normalize_epoch_ms(
            number_at(&value, &["time", "created"]).unwrap_or_else(|| modified_ms(&file)),
        );
        let completed = number_at(&value, &["time", "completed"]).is_some();
        let state = if completed { "done" } else { "running" }.to_string();
        let text = truncate_option_text(
            string_at(&value, &["summary"]).or_else(|| string_at(&value, &["finish"])),
        );
        let repo_path = string_at(&value, &["path", "root"])
            .or_else(|| string_at(&value, &["path", "cwd"]))
            .or_else(|| session_repo.get(&session_id).cloned());

        upsert_agent(
            map,
            AgentTemp {
                key: key.clone(),
                source: "opencode".to_string(),
                session_id: session_id.clone(),
                agent_name: session_name.get(&session_id).cloned(),
                state: state.clone(),
                last_ts_ms: ts,
                last_text: text.clone(),
                repo_path,
                recent_events: vec![MonitorEventView {
                    ts_ms: ts,
                    event_type: "message".to_string(),
                    state_hint: state,
                    text,
                    files_touched: Vec::new(),
                }],
            },
        );
    }

    let part_root = opencode_part_root();
    if !part_root.exists() {
        return;
    }

    let part_files = collect_files(&part_root, "json", MAX_OPENCODE_PART_FILES);
    for file in part_files {
        let raw = match fs::read_to_string(&file) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let value: Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let session_id = string_at(&value, &["sessionID", "sessionId"]);
        let Some(session_id) = session_id else {
            continue;
        };

        let key = format!("opencode:{}", session_id);
        let part_type = string_at(&value, &["type"]).unwrap_or_default();
        let modified = normalize_epoch_ms(modified_ms(&file));

        let (state, event_type, text, ts) = if part_type == "tool" {
            let state_obj = value
                .get("state")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_else(Map::new);
            let status = state_obj
                .get("status")
                .and_then(Value::as_str)
                .map(|s| s.to_string())
                .unwrap_or_else(|| "running".to_string());
            let normalized_status = status.to_lowercase();
            let tool_name = string_at(&value, &["tool"]).unwrap_or_else(|| "tool".to_string());
            let start_ts = state_obj
                .get("time")
                .and_then(Value::as_object)
                .and_then(|t| t.get("start"))
                .and_then(to_i64)
                .map(normalize_epoch_ms)
                .unwrap_or(modified);
            let end_ts = state_obj
                .get("time")
                .and_then(Value::as_object)
                .and_then(|t| t.get("end"))
                .and_then(to_i64)
                .map(normalize_epoch_ms);
            let hint = if normalized_status == "error" {
                "error".to_string()
            } else if normalized_status == "completed" || end_ts.is_some() {
                "done".to_string()
            } else {
                "running".to_string()
            };
            (
                hint,
                if normalized_status == "error" {
                    "error".to_string()
                } else {
                    "tool".to_string()
                },
                Some(format!("{}: {}", tool_name, normalized_status)),
                end_ts.unwrap_or(start_ts),
            )
        } else if part_type == "reasoning" {
            let start_ts = number_at(&value, &["time", "start"])
                .map(normalize_epoch_ms)
                .unwrap_or(modified);
            let end_ts = number_at(&value, &["time", "end"]).map(normalize_epoch_ms);
            (
                "thinking".to_string(),
                "status".to_string(),
                string_at(&value, &["text"]).or_else(|| Some("Thinking".to_string())),
                end_ts.unwrap_or(start_ts),
            )
        } else if part_type == "step-start" {
            (
                "running".to_string(),
                "status".to_string(),
                Some("Step started".to_string()),
                modified,
            )
        } else if part_type == "step-finish" {
            let reason = string_at(&value, &["reason"]).unwrap_or_else(|| "stop".to_string());
            (
                "done".to_string(),
                "status".to_string(),
                Some(format!("Step finished: {}", reason)),
                modified,
            )
        } else {
            continue;
        };

        let text = truncate_option_text(text);

        upsert_agent(
            map,
            AgentTemp {
                key: key.clone(),
                source: "opencode".to_string(),
                session_id: session_id.clone(),
                agent_name: session_name.get(&session_id).cloned(),
                state: state.clone(),
                last_ts_ms: ts,
                last_text: text.clone(),
                repo_path: session_repo.get(&session_id).cloned(),
                recent_events: vec![MonitorEventView {
                    ts_ms: ts,
                    event_type,
                    state_hint: state,
                    text,
                    files_touched: Vec::new(),
                }],
            },
        );
    }
}

fn load_opencode_session_repo_map() -> HashMap<String, String> {
    let mut out = HashMap::new();
    let session_root = opencode_session_root();
    if !session_root.exists() {
        return out;
    }

    let project_root = opencode_project_root();
    let session_files = collect_files(&session_root, "json", MAX_OPENCODE_FILES);
    for file in session_files {
        let raw = match fs::read_to_string(&file) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let value: Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let session_id = string_at(&value, &["id"])
            .or_else(|| {
                file.parent()
                    .and_then(|p| p.file_name())
                    .map(|s| s.to_string_lossy().into_owned())
            })
            .or_else(|| file.file_stem().map(|s| s.to_string_lossy().into_owned()));
        let project_id = string_at(&value, &["projectID", "projectId"]);
        let Some(session_id) = session_id else {
            continue;
        };
        let Some(project_id) = project_id else {
            continue;
        };

        let project_file = project_root.join(format!("{}.json", project_id));
        let project_raw = match fs::read_to_string(project_file) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let project: Value = match serde_json::from_str(&project_raw) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(repo) = string_at(&project, &["worktree"]) {
            out.insert(session_id, repo);
        }
    }

    out
}

fn load_opencode_session_name_map() -> HashMap<String, String> {
    let mut out = HashMap::new();
    let session_root = opencode_session_root();
    if !session_root.exists() {
        return out;
    }

    let session_files = collect_files(&session_root, "json", MAX_OPENCODE_FILES);
    for file in session_files {
        let raw = match fs::read_to_string(&file) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let value: Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let session_id = string_at(&value, &["id"])
            .or_else(|| {
                file.parent()
                    .and_then(|p| p.file_name())
                    .map(|s| s.to_string_lossy().into_owned())
            })
            .or_else(|| file.file_stem().map(|s| s.to_string_lossy().into_owned()));
        let title = string_at(&value, &["title"]);
        if let (Some(session_id), Some(title)) = (session_id, title) {
            out.insert(session_id, title);
        }
    }

    out
}

fn scan_codex(map: &mut HashMap<String, AgentTemp>) {
    let root = codex_sessions_root();
    if !root.exists() {
        return;
    }
    let files = collect_files(&root, "jsonl", MAX_CODEX_FILES);
    for file in files {
        let modified = modified_ms(&file);
        let fallback_session = parse_session_from_filename(&file).unwrap_or_else(|| {
            file.file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "unknown".to_string())
        });
        let tail = match read_tail(&file, CODEX_TAIL_BYTES) {
            Ok(v) => v,
            Err(_) => continue,
        };
        for line in tail.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let record: Value = match serde_json::from_str(trimmed) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let payload = record
                .get("payload")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_else(Map::new);
            let kind = record
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let payload_type = payload
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let session_id = payload
                .get("id")
                .and_then(Value::as_str)
                .map(|s| s.to_string())
                .or_else(|| {
                    record
                        .get("session_id")
                        .and_then(Value::as_str)
                        .map(|s| s.to_string())
                })
                .or_else(|| {
                    record
                        .get("sessionId")
                        .and_then(Value::as_str)
                        .map(|s| s.to_string())
                })
                .unwrap_or_else(|| fallback_session.clone());
            let key = format!("codex:{}", session_id);
            let ts = number_direct(&record, "ts")
                .or_else(|| number_direct(&record, "timestamp"))
                .or_else(|| payload.get("ts").and_then(to_i64))
                .or_else(|| payload.get("timestamp").and_then(to_i64))
                .map(normalize_epoch_ms)
                .unwrap_or(modified);
            let repo_path = payload
                .get("cwd")
                .and_then(Value::as_str)
                .map(|s| s.to_string())
                .or_else(|| {
                    record
                        .get("cwd")
                        .and_then(Value::as_str)
                        .map(|s| s.to_string())
                });
            let (state, event_type, text) =
                classify_codex_event(kind, payload_type, &record, &payload);
            let agent_name = extract_codex_agent_name(kind, payload_type, &record, &payload);

            let event = MonitorEventView {
                ts_ms: ts,
                event_type,
                state_hint: state.clone(),
                text: Some(text.clone()),
                files_touched: Vec::new(),
            };

            let existing = map.entry(key.clone()).or_insert(AgentTemp {
                key: key.clone(),
                source: "codex".to_string(),
                session_id: session_id.clone(),
                agent_name: None,
                state: "idle".to_string(),
                last_ts_ms: ts,
                last_text: Some("Session discovered".to_string()),
                repo_path: repo_path.clone(),
                recent_events: Vec::new(),
            });

            if existing.repo_path.is_none() && repo_path.is_some() {
                existing.repo_path = repo_path;
            }
            if existing.agent_name.is_none() && agent_name.is_some() {
                existing.agent_name = agent_name.clone();
            }
            existing.recent_events.insert(0, event);
            if existing.recent_events.len() > 20 {
                existing.recent_events.truncate(20);
            }
            if ts >= existing.last_ts_ms {
                existing.last_ts_ms = ts;
                existing.state = state;
                existing.last_text = Some(text);
                if agent_name.is_some() {
                    existing.agent_name = agent_name;
                }
            }
        }
    }
}

fn extract_codex_agent_name(
    kind: &str,
    payload_type: &str,
    record: &Value,
    payload: &Map<String, Value>,
) -> Option<String> {
    if kind == "event_msg" && payload_type == "user_message" {
        let message = payload
            .get("message")
            .and_then(Value::as_str)
            .map(|s| s.to_string())
            .or_else(|| {
                record
                    .get("message")
                    .and_then(Value::as_str)
                    .map(|s| s.to_string())
            });
        if let Some(message) = message {
            let first_line = message
                .lines()
                .next()
                .unwrap_or_default()
                .trim()
                .to_string();
            if !first_line.is_empty() {
                return Some(first_line);
            }
        }
    }
    None
}

fn classify_codex_event(
    kind: &str,
    payload_type: &str,
    record: &Value,
    payload: &Map<String, Value>,
) -> (String, String, String) {
    let lower = format!("{} {}", kind.to_lowercase(), payload_type.to_lowercase());
    if lower.contains("task_complete")
        || lower.contains("turn_completed")
        || lower.contains("turn.complete")
        || lower.contains("item.completed")
        || lower.contains("completed")
    {
        return (
            "done".to_string(),
            "status".to_string(),
            "Turn completed".to_string(),
        );
    }
    if lower.contains("turn_aborted") || lower.contains("task_aborted") || lower.contains("aborted")
    {
        return (
            "waiting".to_string(),
            "status".to_string(),
            "Turn aborted".to_string(),
        );
    }
    if lower.contains("error")
        || lower.contains("failed")
        || lower.contains("exception")
        || lower.contains("fatal")
    {
        return (
            "error".to_string(),
            "error".to_string(),
            "Codex error".to_string(),
        );
    }
    if payload_type == "agent_message" || payload_type == "message" {
        let message = record
            .get("message")
            .and_then(Value::as_str)
            .map(|s| s.to_string())
            .or_else(|| {
                payload
                    .get("message")
                    .and_then(Value::as_str)
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| "Assistant message".to_string());
        return ("running".to_string(), "message".to_string(), message);
    }
    if payload_type == "agent_reasoning"
        || payload_type == "reasoning"
        || payload_type == "token_count"
    {
        return (
            "thinking".to_string(),
            "status".to_string(),
            "Thinking".to_string(),
        );
    }
    if payload_type == "task_started" {
        return (
            "running".to_string(),
            "status".to_string(),
            "Task started".to_string(),
        );
    }
    if payload_type == "user_message" {
        return (
            "waiting".to_string(),
            "message".to_string(),
            "Waiting for input".to_string(),
        );
    }
    if payload_type == "function_call" || payload_type == "custom_tool_call" {
        let name = payload
            .get("name")
            .and_then(Value::as_str)
            .map(|s| s.to_string())
            .or_else(|| {
                payload
                    .get("function")
                    .and_then(Value::as_object)
                    .and_then(|m| m.get("name"))
                    .and_then(Value::as_str)
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| "tool".to_string());
        return (
            "running".to_string(),
            "tool".to_string(),
            format!("{}: running", name),
        );
    }
    if payload_type == "function_call_output" || payload_type == "custom_tool_call_output" {
        return (
            "running".to_string(),
            "tool".to_string(),
            "Tool output".to_string(),
        );
    }

    let fallback = record
        .get("message")
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .or_else(|| {
            payload
                .get("message")
                .and_then(Value::as_str)
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| kind.to_string());
    ("running".to_string(), "message".to_string(), fallback)
}

fn upsert_agent(map: &mut HashMap<String, AgentTemp>, incoming: AgentTemp) {
    match map.get_mut(&incoming.key) {
        Some(existing) => {
            if incoming.last_ts_ms >= existing.last_ts_ms {
                let mut merged = incoming;
                if merged.repo_path.is_none() {
                    merged.repo_path = existing.repo_path.clone();
                }
                if merged.last_text.is_none() {
                    merged.last_text = existing.last_text.clone();
                }
                if merged.agent_name.is_none() {
                    merged.agent_name = existing.agent_name.clone();
                }
                *existing = merged;
            }
        }
        None => {
            map.insert(incoming.key.clone(), incoming);
        }
    }
}

fn read_layout_or_default() -> Result<Value, String> {
    let path = layout_file();
    if path.exists() {
        return read_json_file(&path);
    }
    serde_json::from_str(include_str!("../../public/assets/default-layout.json"))
        .map_err(|e| e.to_string())
}

fn read_monitor_settings() -> MonitorSettings {
    match read_json_file(&monitor_settings_file()) {
        Ok(value) => serde_json::from_value(value).unwrap_or_default(),
        Err(_) => MonitorSettings::default(),
    }
}

fn read_sound_enabled() -> bool {
    read_desktop_settings()
        .ok()
        .and_then(|v| v.get("soundEnabled").and_then(Value::as_bool))
        .unwrap_or(true)
}

fn read_demo_mode() -> bool {
    read_desktop_settings()
        .ok()
        .and_then(|v| v.get("demoMode").and_then(Value::as_bool))
        .unwrap_or(false)
}

fn read_desktop_settings() -> Result<Value, String> {
    read_json_file(&sound_settings_file())
}

fn write_desktop_setting_bool(key: &str, value: bool) -> Result<(), String> {
    let mut settings = match read_desktop_settings() {
        Ok(existing) => existing,
        Err(_) => json!({}),
    };
    if !settings.is_object() {
        settings = json!({});
    }
    if let Some(map) = settings.as_object_mut() {
        map.insert(key.to_string(), Value::Bool(value));
    }
    write_json_file(&sound_settings_file(), &settings)
}

fn read_repo_bindings() -> HashMap<String, String> {
    match read_json_file(&repo_bindings_file()) {
        Ok(value) => serde_json::from_value(value).unwrap_or_default(),
        Err(_) => HashMap::new(),
    }
}

fn collect_files(root: &Path, ext: &str, max_files: usize) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = WalkDir::new(root)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| {
            let path = entry.path().to_path_buf();
            let matches = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case(ext))
                .unwrap_or(false);
            if matches {
                Some(path)
            } else {
                None
            }
        })
        .collect();

    files.sort_by(|a, b| modified_ms(b).cmp(&modified_ms(a)));
    if files.len() > max_files {
        files.truncate(max_files);
    }
    files
}

fn truncate_option_text(text: Option<String>) -> Option<String> {
    text.map(truncate_text)
}

fn truncate_text(text: String) -> String {
    if text.chars().count() <= MAX_MONITOR_TEXT_CHARS {
        return text;
    }
    let mut out = String::new();
    for (idx, ch) in text.chars().enumerate() {
        if idx >= MAX_MONITOR_TEXT_CHARS {
            break;
        }
        out.push(ch);
    }
    out.push_str("...");
    out
}

fn modified_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(system_time_to_ms)
        .unwrap_or_else(now_ms)
}

fn normalize_epoch_ms(value: i64) -> i64 {
    if value <= 0 {
        return value;
    }
    if value < 10_000_000_000 {
        return value.saturating_mul(1000);
    }
    if value > 10_000_000_000_000_000 {
        return value / 1_000_000;
    }
    if value > 10_000_000_000_000 {
        return value / 1000;
    }
    value
}

fn system_time_to_ms(time: SystemTime) -> Option<i64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as i64)
}

fn read_tail(path: &Path, max_bytes: usize) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len() as usize;
    let bytes = size.min(max_bytes);
    if bytes == 0 {
        return Ok(String::new());
    }
    file.seek(SeekFrom::Start((size - bytes) as u64))
        .map_err(|e| e.to_string())?;
    let mut buf = vec![0_u8; bytes];
    file.read_exact(&mut buf).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

fn parse_session_from_filename(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_string_lossy().to_string();
    let re = Regex::new(
        r"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$",
    )
    .ok()?;
    re.captures(&stem)
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
}

fn string_at(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str().map(|s| s.to_string())
}

fn number_at(value: &Value, path: &[&str]) -> Option<i64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    to_i64(current)
}

fn number_direct(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(to_i64)
}

fn to_i64(value: &Value) -> Option<i64> {
    if let Some(v) = value.as_i64() {
        return Some(v);
    }
    if let Some(v) = value.as_u64() {
        return Some(v as i64);
    }
    if let Some(v) = value.as_f64() {
        return Some(v as i64);
    }
    None
}

fn short_session(session: &str) -> String {
    session.chars().take(8).collect()
}

fn normalize_agent_name(name: &str) -> Option<String> {
    let compact = name
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    if compact.is_empty() {
        return None;
    }
    let mut out = String::new();
    for (idx, ch) in compact.chars().enumerate() {
        if idx >= 56 {
            break;
        }
        out.push(ch);
    }
    if compact.chars().count() > 56 {
        out.push_str("...");
    }
    Some(out)
}

fn repo_label(repo_path: &str) -> Option<String> {
    let trimmed = repo_path.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = Path::new(trimmed);
    let name = path
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or(trimmed)
        .trim();
    if name.is_empty() {
        return None;
    }
    Some(name.to_string())
}

fn format_agent_display_name(
    source: &str,
    session_id: &str,
    agent_name: Option<&str>,
    repo_path: Option<&str>,
) -> String {
    let normalized_source = normalize_source_name(source);
    if let Some(name) = agent_name.and_then(normalize_agent_name) {
        return format!("{}: {}", normalized_source, name);
    }
    if let Some(repo) = repo_path
        .and_then(repo_label)
        .and_then(|name| normalize_agent_name(&name))
    {
        return format!("{}: {}", normalized_source, repo);
    }
    format!("{}: {}", normalized_source, short_session(session_id))
}

fn now_ms() -> i64 {
    system_time_to_ms(SystemTime::now()).unwrap_or(0)
}

fn claude_available() -> bool {
    command_available("claude")
}

fn command_available(command: &str) -> bool {
    if cfg!(target_os = "windows") {
        Command::new("where")
            .arg(command)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    } else {
        Command::new("sh")
            .arg("-lc")
            .arg(format!("command -v {}", command))
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

fn pixel_agents_dir() -> PathBuf {
    home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".pixel-agents")
}

fn layout_file() -> PathBuf {
    pixel_agents_dir().join("layout.json")
}

fn agent_seats_file() -> PathBuf {
    pixel_agents_dir().join("agent-seats.json")
}

fn monitor_settings_file() -> PathBuf {
    pixel_agents_dir().join("monitor-settings.json")
}

fn sound_settings_file() -> PathBuf {
    pixel_agents_dir().join("desktop-settings.json")
}

fn repo_bindings_file() -> PathBuf {
    pixel_agents_dir().join("monitor-repo-bindings.json")
}

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn write_json_file(path: &Path, value: &Value) -> Result<(), String> {
    ensure_parent(path)?;
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

fn opencode_message_root() -> PathBuf {
    opencode_storage_root().join("message")
}

fn opencode_part_root() -> PathBuf {
    opencode_storage_root().join("part")
}

fn opencode_session_root() -> PathBuf {
    opencode_storage_root().join("session")
}

fn opencode_project_root() -> PathBuf {
    opencode_storage_root().join("project")
}

fn opencode_storage_root() -> PathBuf {
    opencode_data_root().join("storage")
}

fn opencode_db_file() -> PathBuf {
    opencode_data_root().join("opencode.db")
}

fn opencode_data_root() -> PathBuf {
    let configured = std::env::var("OPENCODE_DATA_DIR")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".local")
                .join("share")
                .join("opencode")
        });

    if configured
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.eq_ignore_ascii_case("storage"))
        .unwrap_or(false)
    {
        return configured
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or(configured);
    }
    configured
}

fn codex_sessions_root() -> PathBuf {
    std::env::var("CODEX_HOME")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".codex")
        })
        .join("sessions")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            desktop_bootstrap,
            desktop_save_layout,
            desktop_read_layout,
            desktop_save_agent_seats,
            desktop_set_monitor_settings,
            desktop_set_sound_enabled,
            desktop_set_demo_mode,
            desktop_set_picture_in_picture,
            desktop_bind_repo,
            desktop_sessions_folder,
            desktop_open_path,
            desktop_open_url,
            desktop_launch_agent,
            desktop_choose_repo_folder,
            desktop_copy_text,
            desktop_export_layout,
            desktop_import_layout,
            desktop_monitor_tick
        ])
        .run(tauri::generate_context!())
        .expect("error while running pixel-agents desktop");
}
