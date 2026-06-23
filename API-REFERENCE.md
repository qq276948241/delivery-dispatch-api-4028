# 外卖骑手调度后台 API 参考手册

> 版本：1.0.0  
> 基础地址：`http://<host>:3000/api`  
> 数据格式：JSON  
> 字符编码：UTF-8  
> 时间格式：所有时间字段均为 ISO 8601 字符串（`2026-06-23T10:30:00.000Z`），单位均为毫秒  
> 坐标格式：`[longitude, latitude]`（**注意：经度在前，纬度在后**，符合 GeoJSON 标准）

---

## 目录

1. [全局约定](#1-全局约定)
2. [认证鉴权](#2-认证鉴权)
3. [骑手模块 /riders](#3-骑手模块-riders)
4. [订单模块 /orders](#4-订单模块-orders)
5. [订单状态流转详解](#5-订单状态流转详解)
6. [区域模块 /zones](#6-区域模块-zones)
7. [结算模块 /settlements](#7-结算模块-settlements)
8. [超时与优先级规则](#8-超时与优先级规则)
9. [错误码说明](#9-错误码说明)

---

## 1. 全局约定

### 1.1 统一响应结构

成功时直接返回数据对象/数组：

```json
{
  "_id": "60d21b4667d0d8992e610c85",
  "name": "张骑手",
  "...": "..."
}
```

失败时：

```json
{
  "message": "手机号或密码错误",
  "error": "ForbiddenError",
  "meta": {
    "...": "可选，附加上下文信息"
  }
}
```

分页 / 列表类接口默认返回数组，未做分页。如需分页，前端自行按 `createdAt` 时间戳实现。

### 1.2 枚举值速查

| 字段 | 可选值 |
|---|---|
| `order.status` | `pending`(待接单)、`accepted`(已接单)、`delivering`(配送中)、`delivered`(已送达)、`cancelled`(已取消) |
| `rider.vehicleType` | `electric`(电动车)、`motorcycle`(摩托车)、`bicycle`(自行车) |
| `settlement.status` | `pending`(待结算)、`settled`(已结算) |
| `previousRiders.releaseReason` | `timeout_auto_reassign`(超时自动改派)、`manual_cancel`(手动取消)、`other`(其他) |

### 1.3 金额与距离单位

| 字段 | 单位 |
|---|---|
| 金额（配送费、收入、扣款） | 元（人民币），保留 2 位小数 |
| 距离（distance、totalDistance） | 公里（km） |
| 时间（timeoutMinutes、remainingMinutes） | 分钟 |
| 经纬度 | 度，最多 6 位小数足够米级精度 |

---

## 2. 认证鉴权

所有需认证的接口，请求头必须携带：

```
Authorization: Bearer <token>
```

`<token>` 由登录/注册接口返回。Token 有效期：24 小时。

权限等级：
- **无标记**：公开接口，无需 Token
- **🔐 骑手**：任意已登录骑手可访问
- **🔐 站长**：仅 `isStationMaster=true` 的骑手可访问

---

## 3. 骑手模块 /riders

### 3.1 注册骑手

```
POST /api/riders/register
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `phone` | string | ✅ | 手机号，唯一 |
| `password` | string | ✅ | 密码，≥6 位，存库时自动 bcrypt 加密 |
| `name` | string | ✅ | 姓名 |
| `idCard` | string | ❌ | 身份证号，唯一 |
| `vehicleType` | string | ❌ | `electric`/`motorcycle`/`bicycle`，默认 `electric` |
| `zone` | ObjectId | ❌ | 所属配送区 ID |

**响应 (201)**：

```json
{
  "rider": {
    "_id": "60d21b4667d0d8992e610c85",
    "phone": "13800138000",
    "name": "张骑手",
    "vehicleType": "electric",
    "zone": "60d21b8867d0d8992e610c90",
    "isOnline": false,
    "isStationMaster": false,
    "dispatchPriority": 100,
    "location": { "type": "Point", "coordinates": [0, 0] },
    "todayStats": {
      "date": "2026-06-23T00:00:00.000Z",
      "ordersAccepted": 0,
      "ordersDelivered": 0,
      "totalDistance": 0,
      "totalEarnings": 0,
      "timeoutsCount": 0
    },
    "createdAt": "...",
    "updatedAt": "..."
  },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

### 3.2 登录

```
POST /api/riders/login
```

**请求体**：`{ phone, password }`

**响应 (200)**：同注册返回结构。

### 3.3 上线 🔐 骑手

```
POST /api/riders/online
```

无请求体。将 `isOnline` 置为 `true`，返回更新后的骑手资料（不含密码、todayStats）。

### 3.4 下线 🔐 骑手

```
POST /api/riders/offline
```

无请求体。若仍有 `accepted`/`delivering` 状态的订单，返回 **400**：

```json
{ "message": "还有未完成订单，无法下线" }
```

### 3.5 上报实时位置 🔐 骑手

```
POST /api/riders/location
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `longitude` | number | ✅ | 经度，如 121.4737 |
| `latitude` | number | ✅ | 纬度，如 31.2304 |

**响应 (200)**：更新后的骑手对象。`lastLocationUpdate` 自动记录上报时间。

> 💡 前端建议每 10~30 秒上报一次，异常可放宽至 60 秒。

### 3.6 获取我的资料 🔐 骑手

```
GET /api/riders/me
```

含所属配送区 `zone.name` 信息。

### 3.7 今日配送统计 🔐 骑手

```
GET /api/riders/stats/today
```

**响应 (200)**：

```json
{
  "date": "2026-06-23T00:00:00.000Z",
  "ordersAccepted": 12,
  "ordersDelivered": 8,
  "totalDistance": 24.6,
  "totalEarnings": 128.50,
  "timeoutsCount": 1,
  "deliveringCount": 2
}
```

### 3.8 我的超时记录 🔐 骑手

```
GET /api/riders/timeouts/me
```

**Query 参数**：

| 字段 | 默认 | 说明 |
|---|---|---|
| `days` | 30 | 查询最近 N 天 |
| `limit` | 50 | 返回记录数上限 |

**响应 (200)**：

```json
{
  "stats": {
    "totalTimeouts": 3,
    "dispatchPriority": 70,
    "cooldownUntil": "2026-06-23T12:00:00.000Z",
    "isInCooldown": true,
    "lastTimeoutAt": "2026-06-23T10:15:00.000Z",
    "todayTimeoutsCount": 1
  },
  "history": [
    {
      "orderId": "60d21c0067d0d8992e610d20",
      "timeoutAt": "2026-06-23T10:15:00.000Z",
      "timeoutMinutes": 8,
      "autoReassigned": true,
      "expired": false
    }
  ]
}
```

### 3.9 手动记录超时（站长用） 🔐 站长

```
POST /api/riders/timeouts/record
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `riderId` | ObjectId | ✅ | 目标骑手 |
| `orderId` | ObjectId | ✅ | 关联订单 |
| `timeoutMinutes` | number | ✅ | 超时分钟数（正数） |
| `autoReassigned` | boolean | ❌ | 是否系统自动改派触发，默认 false |

**响应 (200)**：

```json
{
  "message": "超时标记已记录",
  "dispatchPriority": 90,
  "cooldownUntil": "2026-06-23T10:45:00.000Z",
  "timeoutsCount24h": 1
}
```

### 3.10 清除超时记录 🔐 骑手 / 站长

```
POST /api/riders/timeouts/clear          # 清除自己
POST /api/riders/timeouts/clear/:riderId # 站长清除指定骑手
```

清除后 `dispatchPriority` 恢复为 100，`cooldownUntil` 清空，超时历史清空。  
骑手只能清除自己的，站长可以清除任何人的。

### 3.11 查询附近在线骑手

```
GET /api/riders/nearby
```

**Query 参数**：

| 字段 | 默认 | 必填 | 说明 |
|---|---|---|---|
| `longitude` | - | ✅ | 中心经度 |
| `latitude` | - | ✅ | 中心纬度 |
| `maxDistance` | 3000 | ❌ | 搜索半径，单位米 |
| `zoneId` | - | ❌ | 仅返回该配送区骑手 |

**响应 (200)**：按 `dispatchPriority 降序 → lastLocationUpdate 降序` 排序，最多 30 条。

```json
[
  {
    "_id": "...",
    "name": "张骑手",
    "phone": "13800138000",
    "isOnline": true,
    "isStationMaster": false,
    "dispatchPriority": 100,
    "vehicleType": "electric",
    "location": { "type": "Point", "coordinates": [121.4737, 31.2304] },
    "lastLocationUpdate": "2026-06-23T10:29:30.000Z"
  }
]
```

---

## 4. 订单模块 /orders

### 4.1 推送新订单

```
POST /api/orders
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `merchant` | object | ✅ | 商家信息，见下方结构 |
| `customer` | object | ✅ | 顾客信息，同商家结构 |
| `items` | array | ✅ | 订单商品列表 |
| `orderAmount` | number | ✅ | 订单总金额（不含配送费），单位元 |

商家/顾客结构：

```json
{
  "name": "老王麻辣烫",
  "phone": "021-12345678",
  "location": {
    "type": "Point",
    "coordinates": [121.4737, 31.2304]
  },
  "address": "南京东路步行街100号1楼"
}
```

商品 item 结构：

```json
{ "name": "麻辣香锅", "quantity": 1, "price": 38.00 }
```

**响应 (201)**：完整订单对象，详见 5.2。

> 后端会自动：① 按坐标匹配所在配送区；② 计算商家-顾客距离；③ 按距离算配送费；④ 承诺送达时间 = 现在 + 45 分钟；⑤ 生成唯一订单号 `DD<时间戳><4位随机>`。

### 4.2 获取待接单列表

```
GET /api/orders/pending
```

**Query 参数**：

| 字段 | 默认 | 必填 | 说明 |
|---|---|---|---|
| `zoneId` | - | ❌ | 仅返回该配送区订单 |
| `longitude` | - | ❌ | 中心经度，需和 `latitude` 一起传 |
| `latitude` | - | ❌ | 中心纬度 |
| `maxDistance` | 5000 | ❌ | 从中心位置起算的搜索半径，米 |

**响应 (200)**：按创建时间倒序，最多 50 条。

### 4.3 我的订单 🔐 骑手

```
GET /api/orders/my
```

**Query 参数**：`status`（可选，按状态过滤）

### 4.4 骑手抢单 🔐 骑手

```
POST /api/orders/:orderId/accept
```

**可能的响应**：

| 状态 | 说明 |
|---|---|
| 200 OK | 抢单成功，返回更新后的订单对象（含 `rider`、`acceptedAt`） |
| 400 | 未上线 / 非 pending 状态 / 之前被此骑手超时释放过 / 达到并发上限 |
| 403 | 处于冷却期 / 优先级低于 20 |
| 409 Conflict | 并发冲突（同时被别人抢走了），请刷新列表重试 |

冷却期响应示例：

```json
{
  "message": "骑手处于超时冷却期，剩余 15 分钟后可接单",
  "cooldownUntil": "2026-06-23T10:45:00.000Z",
  "remainingMinutes": 15
}
```

并发上限响应示例：

```json
{
  "message": "同时配送订单数已达上限（6），请先完成已有订单",
  "currentCount": 6,
  "maxConcurrent": 6
}
```

并发冲突（乐观锁）响应示例：

```json
{
  "message": "乐观锁校验失败，数据版本不匹配",
  "error": "ConcurrencyError",
  "meta": {
    "id": "60d21b4667d0d8992e610c85",
    "expectedVersion": 5
  }
}
```

### 4.5 订单状态流转 🔐 骑手

```
PUT /api/orders/:orderId/status
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `status` | string | ✅ | `delivering` 或 `delivered` 或 `cancelled` |
| `reason` | string | ❌ | `cancelled` 时的取消原因，默认"骑手取消" |

> ⚠️ 仅该订单绑定的 `rider` 本人能操作。状态机规则详见下一章。

**可能的响应**：

| 状态 | 说明 |
|---|---|
| 200 | 更新成功，返回完整订单对象 |
| 400 | 状态流转不合法（如从 accepted 直接到 delivered） |
| 403 | 非本人订单 |
| 404 | 订单不存在 |
| 409 Conflict | 并发冲突（比如扫描器恰好在这一刻改派了），请刷新订单详情重试 |

### 4.6 订单详情

```
GET /api/orders/:orderId
```

包含 `rider` 和 `zone` 的关联信息（名称、电话）。

### 4.7 手动触发超时扫描 🔐 站长

```
POST /api/orders/timeout/scan
```

通常由定时器每 60 秒自动触发，此接口用于调试或应急。

**响应 (200)**：

```json
{
  "scannedAt": "2026-06-23T10:30:00.000Z",
  "totalReassigned": 3,
  "totalSkipped": 1,
  "reassigned": [
    {
      "orderId": "60d21c0067d0d8992e610d20",
      "orderNo": "DD202606231030001234",
      "timeoutMinutes": 8
    }
  ],
  "skipped": [
    {
      "orderId": "...",
      "orderNo": "...",
      "reason": "CONCURRENT_MODIFICATION"
    }
  ]
}
```

`skipped` 表示该笔订单在扫描瞬间被骑手操作了（送达/取消），无需再改派。

---

## 5. 订单状态流转详解

### 5.1 状态机

```
                              ┌──────────────────────────┐
                              │   超时（定时器触发）      │
                              │   → 退回 pending         │
                              ▼                          │
        骑手抢单           骑手取餐             骑手点送达
  pending ──────► accepted ──────► delivering ──────► delivered
     │              │                   │
     │              └─── cancelled ◄───┘   (骑手取消/系统取消)
     │
     └─── 无人接单，超时后不会自动取消，会一直挂在池子里
```

### 5.2 允许的流转路径

| 当前状态 | 允许流转到 | 触发方式 |
|---|---|---|
| `pending` | `accepted` | 骑手调 **POST /accept** |
| `accepted` | `delivering` | 骑手调 **PUT /status {status: 'delivering'}**（取餐完成） |
| `accepted` | `cancelled` | 骑手取消 |
| `delivering` | `delivered` | 骑手调 **PUT /status {status: 'delivered'}**（送达） |
| `delivering` | `cancelled` | 骑手取消 |
| `accepted` / `delivering` | **`pending`** | **系统定时器自动改派**（超时且未送达） |
| 其他 → 其他 | - | **禁止**，返回 400 |

### 5.3 各节点时间戳写入

| 动作 | 写入的字段 |
|---|---|
| 订单创建 | `createdAt`、`promisedDeliveryTime = 现在 + 45 分钟` |
| 骑手接单 | `acceptedAt = now`、`rider = 当前骑手` |
| 骑手取餐 | `pickedUpAt = now`、status = delivering |
| 骑手送达 | `deliveredAt = now`、计算 `timeoutDeduction`、status = delivered |
| 系统改派 | `previousRiders` 追加历史记录、`rider = null`、`acceptedAt/pickedUpAt = null`、`reassignCount++`、**`promisedDeliveryTime = 现在 + 30 分钟`**（新骑手宽限期） |
| 骑手取消 | `cancelledAt = now`、`cancelReason` |

### 5.4 订单对象完整结构

```json
{
  "_id": "60d21b4667d0d8992e610c85",
  "orderNo": "DD202606231030001234",
  "status": "delivering",
  "merchant": {
    "name": "老王麻辣烫",
    "phone": "021-12345678",
    "location": { "type": "Point", "coordinates": [121.4737, 31.2304] },
    "address": "南京东路步行街100号1楼"
  },
  "customer": {
    "name": "李先生",
    "phone": "13900139000",
    "location": { "type": "Point", "coordinates": [121.4800, 31.2350] },
    "address": "人民广场地铁站1号口"
  },
  "zone": "60d21b8867d0d8992e610c90",
  "rider": { "_id": "...", "name": "张骑手", "phone": "13800138000" },
  "items": [{ "name": "麻辣香锅", "quantity": 1, "price": 38 }],
  "orderAmount": 38.00,
  "deliveryFee": 7.00,
  "distance": 1.8,
  "promisedDeliveryTime": "2026-06-23T11:15:00.000Z",
  "acceptedAt": "2026-06-23T10:32:00.000Z",
  "pickedUpAt": "2026-06-23T10:40:00.000Z",
  "deliveredAt": null,
  "cancelledAt": null,
  "cancelReason": null,
  "timeoutDeduction": 0,
  "reassignCount": 0,
  "previousRiders": [],
  "createdAt": "2026-06-23T10:30:00.000Z",
  "updatedAt": "2026-06-23T10:40:00.000Z",
  "__v": 3
}
```

---

## 6. 区域模块 /zones

### 6.1 创建配送区 🔐 骑手

```
POST /api/zones
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | ✅ | 区域名称（同一城市下唯一） |
| `city` | string | ✅ | 城市名 |
| `boundary` | object | ✅ | GeoJSON Polygon，多边形边界坐标，闭合环 |
| `stationMaster` | ObjectId | ❌ | 站长骑手 ID，若指定会自动把该骑手 `isStationMaster` 置为 true 并绑定 zone |

**boundary 示例（五角场简化矩形，注意坐标格式必须是 `[[[lng, lat], ...]]`，首尾点必须相同）**：

```json
{
  "type": "Polygon",
  "coordinates": [
    [
      [121.5000, 31.3000],
      [121.5200, 31.3000],
      [121.5200, 31.3200],
      [121.5000, 31.3200],
      [121.5000, 31.3000]
    ]
  ]
}
```

### 6.2 查询所有配送区

```
GET /api/zones
```

Query 参数：`city`（可选，按城市过滤）

### 6.3 按坐标查所属配送区

```
GET /api/zones/by-location?longitude=121.4737&latitude=31.2304
```

### 6.4 配送区详情 / 骑手列表 / 更新 / 删除

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/zones/:zoneId` | 详情（含站长信息） |
| GET | `/api/zones/:zoneId/riders` | 该区域所有骑手（不含密码、todayStats） |
| PUT 🔐 | `/api/zones/:zoneId` | 更新信息；更换站长时会把旧站长的 `isStationMaster` 置 false，新的置 true 并绑定 zone |
| DELETE 🔐 | `/api/zones/:zoneId` | 删除区域；会把该区域所有骑手的 `zone` 置 null，站长免职 |

---

## 7. 结算模块 /settlements

### 7.1 核心计算公式

```
当日净收入 =  ∑(每单配送费)
          + 里程奖励
          - 超时扣款合计
          + 其他奖励（预留）
          - 其他扣款（预留）
```

#### 7.1.1 单笔配送费

| 距离 d (km) | 配送费（元） |
|---|---|
| d ≤ 1 | 5.00（起步价） |
| 1 < d ≤ 2 | 7.00 |
| 2 < d ≤ 3 | 9.00 |
| d > 3 | 5.00 + (d - 1) × 2.00，每公里 +2 元 |

> 💡 即 `配送费 = max(5, 5 + (d - 1) * 2)`，d 用 Haversine 公式计算商家-顾客直线距离。

#### 7.1.2 里程奖励

每单距离 > 3km 的部分，每公里额外奖励 **1 元**（3km 以内不算）：
```
里程奖励 = max(0, d - 3) × 1.00   // 累计当日所有订单
```

#### 7.1.3 ⚠️ 超时扣款规则（重点）

骑手**点击"已送达"**的时刻若晚于 `promisedDeliveryTime`，按以下规则扣该单的配送费：

```
超时分钟数 = ⌈ (deliveredAt - promisedDeliveryTime) / 60s ⌉
单扣金额  = min( 超时分钟数 × 0.5 元/分钟 , 该单配送费 × 50% )
```

即：
- **每分钟 0.5 元**
- **封顶**：本单配送费的一半（不会倒扣到比配送费还多）
- 只对该单实际骑手产生，改派后重新计算（新骑手有 30 分钟宽限期）

**示例**：
| 本单配送费 | 超时分钟 | 扣款 | 骑手实得（配送费-扣款） |
|---|---|---|---|
| 7.00 | 5 分钟 | min(2.50, 3.50) = **2.50** | 4.50 |
| 7.00 | 20 分钟 | min(10.00, 3.50) = **3.50**（封顶） | 3.50 |
| 5.00 | 2 分钟 | min(1.00, 2.50) = **1.00** | 4.00 |

> ⚠️ 如果订单**被系统自动改派**（骑手没有点送达），骑手不会被扣"本单超时扣款"（因为订单没算在他的 deliveredOrders 里），但会受到「超时标记 → 降优先级 + 冷却期」的惩罚（见第 8 章），两者是**两套独立的惩罚机制**。

### 7.2 计算当日结算 🔐 骑手

```
POST /api/settlements/calculate
```

**请求体**：`{ date }`（可选，格式 `YYYY-MM-DD`，不传默认今天）

此接口为幂等操作，可反复调用，每次都会根据当日 `delivered` 订单重算并覆盖（Upsert）。返回的结算记录状态为 `pending`（待站长确认日结）。

**响应 (200)**：

```json
{
  "_id": "60d21d0067d0d8992e610e00",
  "rider": { "_id": "...", "name": "张骑手", "phone": "13800138000" },
  "date": "2026-06-23T00:00:00.000Z",
  "orders": [
    { "_id": "...", "orderNo": "...", "deliveryFee": 7.00, "distance": 1.8,
      "timeoutDeduction": 0, "deliveredAt": "..." }
  ],
  "totalOrders": 8,
  "baseDeliveryFees": 56.00,
  "distanceBonus": 6.20,
  "timeoutDeductions": 2.50,
  "otherDeductions": 0,
  "otherBonuses": 0,
  "netEarnings": 59.70,
  "status": "pending",
  "settledAt": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

### 7.3 我的结算记录 🔐 骑手

```
GET /api/settlements/me
```

Query 参数：`date`（可选，查具体某一天）

### 7.4 日期范围结算汇总 🔐 骑手

```
GET /api/settlements/me/range?startDate=2026-06-01&endDate=2026-06-30
```

**响应 (200)**：

```json
{
  "settlements": [ /* 每日明细，按日期升序 */ ],
  "summary": {
    "totalDays": 23,
    "totalOrders": 184,
    "baseDeliveryFees": 1288.00,
    "distanceBonus": 126.40,
    "timeoutDeductions": 28.50,
    "otherBonuses": 0,
    "otherDeductions": 0,
    "netEarnings": 1385.90
  }
}
```

### 7.5 执行日结 🔐 站长

```
POST /api/settlements/settle
```

**请求体**：`{ riderId, date }`（均必填）

将该骑手当日 `pending` 的结算单置为 `settled`，写入 `settledAt`。  
只有站长能执行，且仅对 `pending` 状态生效。

### 7.6 区域结算汇总 🔐 站长

```
GET /api/settlements/zone?zoneId=60d21b8867d0d8992e610c90&date=2026-06-23
```

返回该配送区下全体骑手指定日期的结算记录，按日期倒序。`date` 可选，不传返回全部历史。

---

## 8. 超时与优先级规则

### 8.1 骑手调度优先级（dispatchPriority）

| 指标 | 说明 |
|---|---|
| 初始值 | 100（满分） |
| 计算依据 | 近 **24 小时** 内未过期的超时次数 N |
| 公式 | `priority = max(0, 100 - N × 10)` |
| 参考：N=0→100、N=3→70、N=5→50、N=8→20、N=10+→0 |

### 8.2 冷却期（cooldownUntil）

每次超时触发冷却，时长 = `N × 15 分钟`（N 同上，24h 内累计超时次数）：
- N=1 → 15 分钟
- N=2 → 30 分钟
- ...以此类推

**冷却期内无法接单**，接口返回 403（剩余分钟数见响应）。

### 8.3 并接单上限（与优先级挂钩）

| dispatchPriority 区间 | 最多同时接单数 |
|---|---|
| ≥ 80 分（优质骑手） | 6 单 |
| 50 ~ 79 分（普通） | 4 单 |
| < 50 分（需改进） | 2 单 |
| < 20 分 | **禁止接单**，请联系站长处理 |

### 8.4 优先级阶梯对抢单的影响

1. 搜索「附近在线骑手」接口，返回结果按优先级降序
2. 高优先级骑手可以同时接更多订单
3. 低于 20 分直接无法接单
4. 站长可随时调用「清除超时记录」接口恢复（适用于申诉通过、奖励性恢复等场景）

### 8.5 两套惩罚机制总结

| 场景 | 惩罚项 | 影响范围 |
|---|---|---|
| **送达时超时**（骑手点了送达，但太晚） | 该单 `timeoutDeduction` 扣配送费 | 当日结算收入 |
| **系统改派**（骑手没点送达，定时器触发改派） | 不会被扣配送费，但会记「超时标记」→ 降优先级 + 冷却 | 后续抢单资格/能力 |

> 所以最严重的是「连送达都没点」，会触发改派影响后续抢单；点了送达只是晚点，只扣本单的钱。

---

## 9. 错误码说明

| HTTP 状态码 | error 字段 | 典型场景 |
|---|---|---|
| 400 | `ValidationError` | 参数缺失/非法、状态流转非法、达到并发上限 |
| 401 | - / `Error` | 未带 Token、Token 过期、Token 非法 |
| 403 | `ForbiddenError` | 无权限操作订单、冷却期内接单、优先级过低 |
| 404 | `NotFoundError` | 订单/骑手/区域不存在 |
| 409 | `ConcurrencyError` | **乐观锁冲突**：该订单/数据已被其他操作修改，请刷新重试 |
| 500 | `Error` | 服务器内部错误（数据库异常、代码 bug 等） |

### 前端处理建议

- **401**：清空本地 token，跳转登录页
- **409 Conflict**（重点）：
  - 抢单时：提示"该单已被其他骑手抢走"，刷新订单列表
  - 状态流转时：提示"订单状态已变化，请刷新订单详情"
  - 不要直接提示"乐观锁失败"等技术术语
- **403 冷却期**：展示冷却倒计时（`remainingMinutes`）
- **其他**：统一弹 `message` 字段的内容

---

## 附录：接口总览速查表

| 模块 | Method | Path | 权限 | 用途 |
|---|---|---|---|---|
| 🔑 认证 | POST | `/riders/register` | - | 注册 |
| 🔑 | POST | `/riders/login` | - | 登录 |
| 🏍️ 骑手 | POST | `/riders/online` | 骑手 | 上线 |
| 🏍️ | POST | `/riders/offline` | 骑手 | 下线 |
| 🏍️ | POST | `/riders/location` | 骑手 | 上报位置 |
| 🏍️ | GET | `/riders/me` | 骑手 | 我的资料 |
| 🏍️ | GET | `/riders/stats/today` | 骑手 | 今日统计 |
| 🏍️ | GET | `/riders/timeouts/me` | 骑手 | 我的超时记录 |
| 🏍️ | POST | `/riders/timeouts/record` | 站长 | 手动记超时 |
| 🏍️ | POST | `/riders/timeouts/clear[/:riderId]` | 骑手/站长 | 清除超时 |
| 🏍️ | GET | `/riders/nearby` | - | 附近骑手 |
| 📦 订单 | POST | `/orders` | - | 创建订单 |
| 📦 | GET | `/orders/pending` | - | 待接单列表 |
| 📦 | GET | `/orders/my` | 骑手 | 我的订单 |
| 📦 | GET | `/orders/:orderId` | - | 订单详情 |
| 📦 | POST | `/orders/:orderId/accept` | 骑手 | 抢单 |
| 📦 | PUT | `/orders/:orderId/status` | 骑手 | 状态流转 |
| 📦 | POST | `/orders/timeout/scan` | 站长 | 手动超时扫描 |
| 🗺️ 区域 | GET | `/zones` | - | 配送区列表 |
| 🗺️ | GET | `/zones/by-location` | - | 按坐标查区 |
| 🗺️ | GET | `/zones/:zoneId` | - | 区详情 |
| 🗺️ | GET | `/zones/:zoneId/riders` | - | 区骑手列表 |
| 🗺️ | POST | `/zones` | 骑手 | 创建区 |
| 🗺️ | PUT | `/zones/:zoneId` | 骑手 | 更新区 |
| 🗺️ | DELETE | `/zones/:zoneId` | 骑手 | 删除区 |
| 💰 结算 | POST | `/settlements/calculate` | 骑手 | 计算当日结算 |
| 💰 | GET | `/settlements/me` | 骑手 | 我的结算 |
| 💰 | GET | `/settlements/me/range` | 骑手 | 范围汇总 |
| 💰 | POST | `/settlements/settle` | 站长 | 执行日结 |
| 💰 | GET | `/settlements/zone` | 站长 | 区域结算 |

（完）
