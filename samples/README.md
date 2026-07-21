# Lantern 开发样例

这里存放可重复创建的显式示例漫画。空的本地数据目录会初始化经过验收的 starter samples；业务加载失败时不能把任何示例作为跨漫画兜底内容。

除非具体文件另有声明，随仓库分发的示例内容与静态素材适用根目录 MIT License，不依赖外部下载或仅限内部使用的素材。

每个样例使用一个目录，例如 `rainy-station/` 或 `campus-letter/`：

- `seed.ts`：唯一的数据库、任务、候选与工作稿构造入口；必须可幂等重建。
- `public/samples/<sample-id>/`：该样例所需的静态源图，仅在 seed 或离线 fixture 中读取。
- 样例必须使用自己的固定 Comic、Chapter、Project ID，不能被新建漫画或空白一话复用。
- 示例资产可以进入资产列表和资产空间，但 seed 不创建 `CanvasReferencePlacement`；重建后不能让参考资产自动铺在创作画布上遮挡作品页面。

新增样例时，新增目录和对应静态目录，并在 `package.json` 添加一个明确的 `db:sample:<id>` 命令；不要再把图片、seed 或 mock 数据散落到 `public/`、`prisma/` 或通用 fixture 目录。
