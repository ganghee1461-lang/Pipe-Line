#!/usr/bin/env bash
# ── 도로명주소 실폭도로(TL_SPRD_RW) → 앱용 도로면 GeoJSON 추출 ──
#
# 실폭도로 = "실제 도로로 쓰이는 면" 폴리곤.
#   · 복개천처럼 하천을 덮어 도로가 된 곳 → 도로명이 있어 포함됨 ✓
#   · 열린 하천 → 도로명이 없어 제외됨 ✓
# 즉 배관이 실제로 지날 수 있는 통로에 가장 가깝다. (지목 기반 판정의 오류를 대체)
#
# 사용법:
#   npm install -g mapshaper
#   bash tools/extract-roads.sh ~/Downloads/'(도로명주소)실폭도로_충북 (1)'/TL_SPRD_RW_43_202608.shp
#
# 옵션(환경변수):
#   SGG="43150 43750 43770 43800"  대상 시군구 (기본: 제천·진천·음성·단양)
#   SIMPLIFY="30%"                 단순화 비율
#   ENCODING="euckr"               한글 깨지면 utf8
#   OUT=./roads-out                출력 폴더

set -euo pipefail

SRC="${1:-}"
if [[ -z "$SRC" || ! -f "$SRC" ]]; then
  echo "사용법: bash tools/extract-roads.sh <TL_SPRD_RW_*.shp>" >&2
  exit 1
fi

SGG="${SGG:-43150 43750 43770 43800}"
SIMPLIFY="${SIMPLIFY:-30%}"
ENCODING="${ENCODING:-euckr}"
OUT="${OUT:-./roads-out}"
SIDO="$(echo "$SGG" | awk '{print substr($1,1,2)}')"
HERE="$(cd "$(dirname "$0")" && pwd)"

command -v mapshaper >/dev/null 2>&1 || { echo "mapshaper 없음:  npm install -g mapshaper" >&2; exit 1; }

export NODE_OPTIONS="--max-old-space-size=8192"
mkdir -p "$OUT"
rm -f "$OUT"/*.json

echo "▶ 원본: $SRC"
echo "▶ 대상: $SGG / 단순화 $SIMPLIFY / 인코딩 $ENCODING"
echo

# ── 1단계: 속성 구조 확인 후 시군구 필드 자동 탐지 ──
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mapshaper -i "$SRC" encoding="$ENCODING" \
  -filter 'this.id < 200' \
  -o "$TMP/sample.json" format=json >/dev/null 2>&1
FIELD="$(node "$HERE/detect-field.mjs" "$TMP/sample.json" "$SIDO")"
echo

# ── 2단계: 필터 → 좌표변환 → 단순화 → 시군구별 분할 ──
if [[ -n "$FIELD" ]]; then
  FILTER=""
  for code in $SGG; do
    [[ -n "$FILTER" ]] && FILTER="$FILTER || "
    FILTER="${FILTER}String(${FIELD}).indexOf('${code}') === 0"
  done
  mapshaper -i "$SRC" encoding="$ENCODING" \
    -filter "$FILTER" \
    -each "sgg = String(${FIELD}).substring(0,5)" \
    -filter-fields sgg \
    -proj wgs84 \
    -simplify "$SIMPLIFY" keep-shapes \
    -clean \
    -split sgg \
    -o "$OUT" format=geojson precision=0.000001
  for f in "$OUT"/sgg-*.json; do
    [[ -e "$f" ]] || continue
    mv "$f" "$OUT/$(basename "$f" | sed 's/^sgg-//')"
  done
else
  echo "! 시군구 필드를 못 찾아 전체를 한 파일로 만듭니다(용량 주의)."
  mapshaper -i "$SRC" encoding="$ENCODING" \
    -filter-fields \
    -proj wgs84 \
    -simplify "$SIMPLIFY" keep-shapes \
    -clean \
    -o "$OUT/roads.json" format=geojson precision=0.000001
fi

node "$HERE/make-manifest.mjs" "$OUT"

echo
echo "✔ 완료 → $OUT"
du -sh "$OUT"
ls -lh "$OUT"/*.json | awk '{print "   ", $9, $5}'
