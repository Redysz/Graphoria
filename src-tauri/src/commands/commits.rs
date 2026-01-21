#[tauri::command]
pub(crate) fn list_commits(
    repo_path: String,
    max_count: Option<u32>,
    only_head: Option<bool>,
    history_order: Option<String>,
) -> Result<Vec<crate::GitCommit>, String> {
    let max_count = max_count.unwrap_or(200).min(2000);
    let history_order = history_order.unwrap_or_else(|| String::from("topo"));
    crate::list_commits_impl_v2(&repo_path, Some(max_count), only_head.unwrap_or(false), &history_order)
}

#[tauri::command]
pub(crate) fn list_commits_full(
    repo_path: String,
    only_head: Option<bool>,
    history_order: Option<String>,
) -> Result<Vec<crate::GitCommit>, String> {
    let history_order = history_order.unwrap_or_else(|| String::from("topo"));
    crate::list_commits_impl_v2(&repo_path, None, only_head.unwrap_or(false), &history_order)
}
