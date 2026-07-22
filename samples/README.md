# Lantern 基础作品数据

这里保存《风停之前》的可重复构造入口与随仓库分发的静态素材。业务加载失败时不能把这些内容作为跨漫画兜底数据。

`campus-letter/seed.ts` 负责数据库、任务、候选和工作稿构造，并保持幂等；对应图片位于 `apps/web/public/samples/campus-letter/`。构造过程不创建 `CanvasReferencePlacement`，避免参考资产自动铺到创作画布上。

除非具体文件另有声明，随仓库分发的内容与静态素材适用根目录 MIT License。
