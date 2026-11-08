# 曲げの式

## 位置

地面は y = 0、上が +y。注目点 F（地面の上）、球の半径 R（小さいほど強く曲がる）、強さ a（0〜1）。

球の中心は (F.x, -R, F.z)。地面の点は球の表面に、高さ h の点は半径 R + h の所に移る。

```glsl
uniform vec3  uBendFocus;   // 注目点（ワールド、y=0）
uniform float uBendRadius;  // R
uniform float uBendAmount;  // 0 = 平ら

vec3 wwtBend(vec3 p) {
  vec2 d = p.xz - uBendFocus.xz;
  float r = length(d);
  if (uBendAmount <= 0.0 || r < 1e-5) return p;
  vec2 dir = d / r;
  float theta = r / uBendRadius;
  float rr = uBendRadius + p.y;
  vec2 xz = uBendFocus.xz + dir * rr * sin(theta);
  float y = rr * cos(theta) - uBendRadius;
  return mix(p, vec3(xz.x, y, xz.y), uBendAmount);
}
```

θ が小さいときは元の位置にほぼ一致する（y ≒ h − r²/2R）。注目点の真下は常に平ら。

カメラ距離 D から R を決める目安：`R = k * D`（k は 0.6〜1.5 で見て決める）。D が街を歩く距離のときは a = 0 にし、遠ざかるほど a を 1 へ上げる。D・R・a は対数でつなぐ。

## 法線

dir 方向の接線 t = (dir.x, 0, dir.y)、上 u = (0, 1, 0)。法線 n を a = n·t、b = n·u に分け、残りはそのまま。

```
a' = a cosθ + b sinθ
b' = -a sinθ + b cosθ
n' = n - a t - b u + a' t + b' u
```

上向きの法線は、球の外向きの法線 (sinθ·dir, cosθ) になる。強さ a を使うときは、θ に a を掛けて回す。

## WebGL での差し込み

`#include <project_vertex>` を差し替える。インスタンスとスキニングの後の `transformed` を使う。

```glsl
vec4 wPos = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  wPos = instanceMatrix * wPos;
#endif
wPos = modelMatrix * wPos;
wPos.xyz = wwtBend(wPos.xyz);
vec4 mvPosition = viewMatrix * wPos;
gl_Position = projectionMatrix * mvPosition;
```

影（`customDepthMaterial`・`customDistanceMaterial`）と、法線を使う所（`defaultnormal_vertex` の後）にも同じ曲げを入れる。three.js の版でチャンク名が変わっていないか、入れた版で確かめる。

## WebGPU（TSL）

同じ式を TSL のノードで書き、ワールド座標で曲げてから `cameraProjectionMatrix * cameraViewMatrix` を掛けた位置を頂点の出力にする。API は版で変わってきたので、入れた three.js の版の例で確かめる。

## 輪郭線（裏返した一回り大きい形）

曲げた後の位置と法線で、クリップ空間で外へ押す。太さは画面の画素でそろう。

```glsl
vec4 clip = projectionMatrix * viewMatrix * vec4(wwtBend(worldPos), 1.0);
vec3 nView = normalize((viewMatrix * vec4(bentNormalWorld, 0.0)).xyz);
vec2 nClip = normalize((projectionMatrix * vec4(nView, 0.0)).xy);
clip.xy += nClip * uOutlinePx * 2.0 / uResolution * clip.w;
gl_Position = clip;
```

面は裏側だけ描く（BackSide）。

## 選び（クリック判定）

曲がった画面では光線を飛ばす方法が使えない。代わりに、同じ曲げで次の2つを小さな画像に描き、押した画素を読む。

- 物の番号（どの建物・部品か）
- 曲げる前の平らな座標 xz（float の画像）。これが「平らな地面のどこを押したか」の答えになる

読むのは押したときだけ。毎フレーム描かない。

## UI の板を本物の操作として扱える条件

板の四隅を、曲げありと曲げなしで画面に投影し、ずれが全部 1px 未満のときだけ、本物の UI の操作として届ける。それ以外は探索の操作（そこへ飛ぶ）にする。
