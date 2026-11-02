//! 窗口几何的纯逻辑（task-17 P0）。
//!
//! 背景：真机里保存过的大窗口几何（例如 2560×1440）在 1707 宽的屏幕上恢复，
//! 右侧会超出屏幕。这里只做「给定保存矩形 + 当前显示器工作区」的安全计算：
//! - 宽高先夹到工作区；
//! - x/y 夹到工作区内；
//! - 完全在工作区外（显示器拔掉/换屏/负坐标）→ 居中回退到默认尺寸；
//! - 工作区比最小窗口还小时，允许窗口缩到工作区大小（保证可见）。
//!
//! 真正的 Tauri/Win32 调用在 main.rs；本模块不依赖 Tauri，方便单测。

/// 屏幕坐标矩形（物理像素；调用方负责单位一致）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GeoRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl GeoRect {
    pub fn right(&self) -> i64 {
        self.x as i64 + self.width as i64
    }

    pub fn bottom(&self) -> i64 {
        self.y as i64 + self.height as i64
    }

    /// 与另一个矩形的交集面积（无交集 = 0）。
    pub fn intersection_area(&self, other: &GeoRect) -> u64 {
        let left = self.x.max(other.x) as i64;
        let top = self.y.max(other.y) as i64;
        let right = self.right().min(other.right());
        let bottom = self.bottom().min(other.bottom());
        if right <= left || bottom <= top {
            return 0;
        }
        ((right - left) as u64) * ((bottom - top) as u64)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GeoSize {
    pub width: u32,
    pub height: u32,
}

/// 与 tauri.conf.json 的 minWidth/minHeight 保持一致。
pub const MIN_WINDOW_WIDTH: u32 = 420;
pub const MIN_WINDOW_HEIGHT: u32 = 620;

fn sanitize_work_area(work: GeoRect) -> GeoRect {
    GeoRect {
        x: work.x,
        y: work.y,
        width: work.width.max(1),
        height: work.height.max(1),
    }
}

fn fitted_size(saved: GeoSize, work: GeoRect, min: GeoSize) -> GeoSize {
    let min_width = min.width.min(work.width).max(1);
    let min_height = min.height.min(work.height).max(1);
    GeoSize {
        width: saved.width.max(min_width).min(work.width),
        height: saved.height.max(min_height).min(work.height),
    }
}

/// 把任意尺寸居中放到工作区（先夹到工作区）。
pub fn centered(work: GeoRect, size: GeoSize) -> GeoRect {
    let work = sanitize_work_area(work);
    let size = GeoSize {
        width: size.width.min(work.width).max(1),
        height: size.height.min(work.height).max(1),
    };
    GeoRect {
        x: work.x + ((work.width.saturating_sub(size.width)) / 2) as i32,
        y: work.y + ((work.height.saturating_sub(size.height)) / 2) as i32,
        width: size.width,
        height: size.height,
    }
}

/// 恢复窗口几何的核心：
/// - `saved=None`/宽高为 0 → 用 `preferred` 尺寸居中（默认窗口）；
/// - 保存的窗口与工作区完全无交集（旧显示器被拔掉/DPR/分辨率变化）→ 夹好尺寸后居中；
/// - 否则夹 width/height 到工作区、再夹 x/y，保证整个窗口在工作区内。
/// 返回 `(rect, adjusted)`：adjusted 表示是否发生了 clamp/回退（用于日志）。
pub fn restore_rect(saved: Option<GeoRect>, work: GeoRect, min: GeoSize, preferred: GeoSize) -> (GeoRect, bool) {
    let work = sanitize_work_area(work);
    let preferred = fitted_size(preferred, work, min);
    let Some(saved) = saved.filter(|rect| rect.width > 0 && rect.height > 0) else {
        return (centered(work, preferred), true);
    };
    let size = fitted_size(GeoSize { width: saved.width, height: saved.height }, work, min);
    let mut adjusted = size.width != saved.width || size.height != saved.height;

    // 旧窗口完全不在工作区里：回退为居中（保留夹好的大小），不要贴边留一条缝。
    if saved.intersection_area(&work) == 0 {
        let mut rect = centered(work, size);
        rect.width = size.width;
        rect.height = size.height;
        return (rect, true);
    }

    let max_x = (work.right() - size.width as i64) as i32;
    let max_y = (work.bottom() - size.height as i64) as i32;
    let x = saved.x.clamp(work.x.min(max_x), max_x);
    let y = saved.y.clamp(work.y.min(max_y), max_y);
    adjusted |= x != saved.x || y != saved.y;
    (GeoRect { x, y, width: size.width, height: size.height }, adjusted)
}

/// 窗口是否完整落在工作区内（用于恢复后校验）。
pub fn fully_visible(rect: &GeoRect, work: &GeoRect) -> bool {
    let work = sanitize_work_area(*work);
    rect.x >= work.x
        && rect.y >= work.y
        && rect.right() <= work.right()
        && rect.bottom() <= work.bottom()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn work(x: i32, y: i32, width: u32, height: u32) -> GeoRect {
        GeoRect { x, y, width, height }
    }

    fn saved(x: i32, y: i32, width: u32, height: u32) -> GeoRect {
        GeoRect { x, y, width, height }
    }

    const MIN: GeoSize = GeoSize { width: MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT };
    const PREFERRED: GeoSize = GeoSize { width: 1280, height: 840 };

    #[test]
    fn oversized_saved_geometry_fits_1707_work_area() {
        // 真机回归：保存 2560×1440，恢复时屏幕工作区 1707×960（含任务栏）。
        let work = work(0, 0, 1707, 960);
        let (rect, adjusted) = restore_rect(Some(saved(0, 0, 2560, 1440)), work, MIN, PREFERRED);
        assert!(adjusted);
        assert_eq!(rect.width, 1707);
        assert_eq!(rect.height, 960);
        assert_eq!(rect.x, 0);
        assert_eq!(rect.y, 0);
        assert!(fully_visible(&rect, &work));
    }

    #[test]
    fn oversized_centered_saved_geometry_stays_visible() {
        // 居中保存 2560×1440（x=-426）在 1707 屏：尺寸夹到工作区。
        let work = work(0, 0, 1707, 960);
        let (rect, _) = restore_rect(Some(saved(-426, -240, 2560, 1440)), work, MIN, PREFERRED);
        assert_eq!(rect.width, 1707);
        assert_eq!(rect.height, 960);
        assert!(rect.x >= 0 && rect.y >= 0);
        assert!(fully_visible(&rect, &work));
    }

    #[test]
    fn right_edge_overflow_is_clamped_inside() {
        let work = work(0, 0, 1707, 960);
        let (rect, adjusted) = restore_rect(Some(saved(1200, 300, 1280, 840)), work, MIN, PREFERRED);
        assert!(adjusted);
        assert_eq!(rect.right(), 1707);
        assert_eq!(rect.bottom(), 960);
        assert!(fully_visible(&rect, &work));
    }

    #[test]
    fn negative_offscreen_coordinates_fall_back_centered() {
        let work = work(0, 0, 1707, 960);
        let (rect, adjusted) = restore_rect(Some(saved(-5000, -4000, 1280, 840)), work, MIN, PREFERRED);
        assert!(adjusted);
        assert!(rect.x >= 0 && rect.y >= 0);
        assert!(fully_visible(&rect, &work));
        // 无交集 → 居中回退。
        assert_eq!(rect.x, ((1707 - rect.width) / 2) as i32);
    }

    #[test]
    fn removed_second_monitor_falls_back_to_primary() {
        // 原窗口在 x=1920 的第二显示器；现在只剩 0..1707 主屏。
        let work = work(0, 0, 1707, 960);
        let (rect, adjusted) = restore_rect(Some(saved(1920, 100, 1280, 840)), work, MIN, PREFERRED);
        assert!(adjusted);
        assert!(fully_visible(&rect, &work));
        assert_eq!(rect.x, ((1707 - rect.width) / 2) as i32);
    }

    #[test]
    fn taskbar_work_area_offset_and_height_are_respected() {
        // 工作区不是 (0,0) 且含任务栏：y=40、高=920。
        let work = work(100, 40, 1700, 920);
        let (rect, adjusted) = restore_rect(Some(saved(0, 0, 1280, 840)), work, MIN, PREFERRED);
        assert!(adjusted);
        assert!(rect.x >= 100);
        assert!(rect.y >= 40);
        assert!(fully_visible(&rect, &work));
    }

    #[test]
    fn small_saved_window_is_raised_to_min_but_never_beyond_work_area() {
        let work = work(0, 0, 1707, 960);
        let (rect, adjusted) = restore_rect(Some(saved(10, 10, 100, 100)), work, MIN, PREFERRED);
        assert!(adjusted);
        assert_eq!(rect.width, MIN_WINDOW_WIDTH);
        assert_eq!(rect.height, MIN_WINDOW_HEIGHT);
        assert!(fully_visible(&rect, &work));
    }

    #[test]
    fn work_area_smaller_than_min_allows_shrink_to_fit() {
        // 360×640 小屏（或窄工作区）：不能强行 420×620 溢出。
        let work = work(0, 0, 360, 640);
        let (rect, _) = restore_rect(Some(saved(0, 0, 1280, 840)), work, MIN, PREFERRED);
        assert_eq!(rect.width, 360);
        assert_eq!(rect.height, 640);
        assert!(fully_visible(&rect, &work));
    }

    #[test]
    fn missing_geometry_uses_default_window_centered() {
        let work = work(0, 0, 1707, 960);
        let (rect, adjusted) = restore_rect(None, work, MIN, PREFERRED);
        assert!(adjusted);
        assert_eq!(rect.width, PREFERRED.width);
        assert_eq!(rect.height, PREFERRED.height);
        assert!(fully_visible(&rect, &work));
    }

    #[test]
    fn invalid_zero_geometry_is_treated_as_missing() {
        let work = work(0, 0, 1707, 960);
        let (rect, adjusted) = restore_rect(Some(saved(0, 0, 0, 0)), work, MIN, PREFERRED);
        assert!(adjusted);
        assert!(fully_visible(&rect, &work));
    }

    #[test]
    fn already_fitting_geometry_is_untouched() {
        let work = work(0, 0, 1920, 1080);
        let rect = saved(100, 120, 1280, 840);
        let (out, adjusted) = restore_rect(Some(rect), work, MIN, PREFERRED);
        assert!(!adjusted);
        assert_eq!(out, rect);
    }

    #[test]
    fn secondary_monitor_offset_is_respected_when_monitor_still_exists() {
        let secondary = work(1920, 0, 1920, 1080);
        let rect = saved(2000, 50, 1280, 840);
        let (out, adjusted) = restore_rect(Some(rect), secondary, MIN, PREFERRED);
        assert!(!adjusted);
        assert_eq!(out, rect);
        assert!(fully_visible(&out, &secondary));
    }

    #[test]
    fn dpi_scaled_logical_geometry_fits_physical_work_area() {
        // task-17 真机形态：屏幕物理 1707×960；若当前 125% 缩放，则逻辑工作区 1365×768。
        // 保存的逻辑几何 1585×891 @ (29,84) 直接按逻辑恢复会物理溢出 → 必须夹到逻辑工作区。
        let work_logical = work(0, 0, 1365, 768);
        let (rect, adjusted) = restore_rect(Some(saved(29, 84, 1585, 891)), work_logical, MIN, PREFERRED);
        assert!(adjusted);
        assert!(fully_visible(&rect, &work_logical));
        // 换回物理：1707×960 工作区内应放得下（右/下不溢出）。
        let scale = 1.25;
        let physical = GeoRect {
            x: (rect.x as f64 * scale).round() as i32,
            y: (rect.y as f64 * scale).round() as i32,
            width: (rect.width as f64 * scale).round() as u32,
            height: (rect.height as f64 * scale).round() as u32,
        };
        assert!(fully_visible(&physical, &work(0, 0, 1707, 960)));
    }

    #[test]
    fn real_saved_geometry_bottom_below_taskbar_is_clamped() {
        // 当前机器实际保存值：1585×891 @ (29,84)；1707×960 工作区下 y+height=975 > 960。
        let work = work(0, 0, 1707, 960);
        let (rect, adjusted) = restore_rect(Some(saved(29, 84, 1585, 891)), work, MIN, PREFERRED);
        assert!(adjusted);
        assert_eq!(rect.width, 1585);
        assert_eq!(rect.height, 891);
        assert_eq!(rect.y, 960 - 891);
        assert!(fully_visible(&rect, &work));
    }
}
