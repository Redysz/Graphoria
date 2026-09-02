#[tauri::command]
pub(crate) async fn list_commits(
    repo_path: String,
    max_count: Option<u32>,
    only_head: Option<bool>,
    history_order: Option<String>,
) -> Result<Vec<crate::GitCommit>, String> {
    crate::repo_read(repo_path.clone(), move || {
        let max_count = max_count.unwrap_or(200).min(2001);
        let history_order = history_order.unwrap_or_else(|| String::from("topo"));
        crate::list_commits_impl_v2(&repo_path, Some(max_count), only_head.unwrap_or(false), &history_order)
    })
    .await
}

#[tauri::command]
pub(crate) async fn list_commits_full(
    repo_path: String,
    only_head: Option<bool>,
    history_order: Option<String>,
) -> Result<Vec<crate::GitCommit>, String> {
    crate::repo_read(repo_path.clone(), move || {
        let history_order = history_order.unwrap_or_else(|| String::from("topo"));
        crate::list_commits_impl_v2(&repo_path, None, only_head.unwrap_or(false), &history_order)
    })
    .await
}
