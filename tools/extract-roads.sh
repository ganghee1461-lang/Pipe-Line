#!/usr/bin/env bash
# ── 도로명주소 도로구간(중심선) → 앱 라우팅용 GeoJSON 추출 ──
#
# 도로구간은 "도로명이 부여된 실제 통행로"의 중심선이라,
#   · 복개천처럼 하천을 덮어 도로가 된 곳 → 도로명이 있어 포함 ✓
#   · 열린 하천 → 도로명이 없어 제외 ✓
# 자동 연결(공급관)의 도로망으로 사용한다. OSM보다 정확하고 공식 데이터.
#
# 사용법:
#   npm install -g mapshaper
#   bash tools/extract-roads.sh ~/Downloads/도로구간폴더/TL_SPRD_MANAGE_43_202608.shp
#
# 옵션(환경변수):
#   SGG=""           대상 시군구코드 (비우면 전체). 예: SGG="43150 43800"
#   SIMPLIFY="20%"   단순화 비율 (중심선이라 형상 손실 부담이 적음)
#   ENCODING=euckr   한글 깨지면 utf8
#   OUT=./roads-out  출력 폴더

set -euo pipefail

SRC="${1:-}"
if [[ -z "$SRC" || ! -f "$SRC" ]]; then
  echo "사용법: bash tools/extract-roads.sh <도로구간.shp>" >&2
  exit 1
fi

SGG="${SGG-}"                 # 기본: 전체
SIMPLIFY="${SIMPLIFY:-20%}"
ENCODING="${ENCODING:-euckr}"
OUT="${OUT:-./roads-out}"
HERE="$(cd "$(dirname "$0")" && pwd)"

command -v mapshaper >/dev/null 2>&1 || { echo "mapshaper 없음:  npm install -g mapshaper" >&2; exit 1; }

export NODE_OPTIONS="--max-old-space-size=8192"
mkdir -p "$OUT"; rm -f "$OUT"/*.json

echo "▶ 원본  : $SRC"
echo "▶ 대상  : ${SGG:-충북 전체} / 단순화 $SIMPLIFY / 인코딩 $ENCODING"
echo

# 1) 속성 구조 확인 → 시군구 필드 자동 탐지
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mapshaper -i "$SRC" encoding="$ENCODING" -filter 'this.id < 200' \
  -o "$TMP/sample.json" format=json >/dev/null 2>&1
SIDO="$(basename "$SRC" | grep -oE '_[0-9]{2}_' | head -1 | tr -d '_' || echo '')"
FIELD="$(node "$HERE/detect-field.mjs" "$TMP/sample.json" "$SIDO")"
echo

if [[ -z "$FIELD" ]]; then
  echo "! 시군구 필드를 못 찾았습니다. 위 속성 목록을 확인해 주세요." >&2
  exit 1
fi

# 2) (선택)시군구 필터 → 좌표변환 → 단순화 → 시군구별 분할
CMD=(-i "$SRC" encoding="$ENCODING")
if [[ -n "$SGG" ]]; then
  FILTER=""
  for code in $SGG; do
    [[ -n "$FILTER" ]] && FILTER="$FILTER || "
    FILTER="${FILTER}String(${FIELD}).indexOf('${code}') === 0"
  done
  CMD+=(-filter "$FILTER")
fi
CMD+=(
  -each "sgg = String(${FIELD}).substring(0,5)"
  -filter-fields sgg
  -proj wgs84
  -simplify "$SIMPLIFY" keep-shapes
  -split sgg
  -o "$OUT" format=geojson precision=0.00001
)
mapshaper "${CMD[@]}"

for f in "$OUT"/sgg-*.json; do
  [[ -e "$f" ]] || continue
  mv "$f" "$OUT/$(basename "$f" | sed 's/^sgg-//')"
done

node "$HERE/make-manifest.mjs" "$OUT"

echo
echo "✔ 완료 → $OUT"
du -sh "$OUT"
ls -lh "$OUT"/*.json | awk '{print "   ", $9, $5}'
echo
echo "다음: 이 폴더의 모든 .json 을 R2 버킷에 업로드하고 공개 URL을 알려주세요."
