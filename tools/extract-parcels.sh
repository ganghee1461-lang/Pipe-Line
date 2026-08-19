#!/usr/bin/env bash
# ── 연속지적도(LSMD_CONT_LDREG) → 앱용 필지 GeoJSON 추출 ──
#
# 원본: 국가공간정보포털 연속지적도 시도 단위 shp (예: LSMD_CONT_LDREG_43_202608.shp)
# 결과: 읍면동(PNU 앞 10자리)별 GeoJSON + manifest.json  → R2 업로드용
#
# 남기는 속성은 두 개뿐이라 용량이 크게 줄어든다:
#   p = PNU(19자리)   ← 시군구·읍면동·본번·부번 전부 여기서 파생
#   j = 지목(1글자)    ← JIBUN "868-1 도" 의 뒤쪽. 도/구/천/제/유 등 공공성 판정에 사용
#
# 사용법:
#   brew install node                    # 없으면
#   npm install -g mapshaper
#   bash tools/extract-parcels.sh ~/Downloads/LSMD_CONT_LDREG_충북/LSMD_CONT_LDREG_43_202608.shp
#
# 옵션(환경변수):
#   SGG="43150 43750 43770 43800"  대상 시군구코드 (기본: 제천·진천·음성·단양)
#   SIMPLIFY="40%"                 단순화 비율 (낮출수록 가벼움/거침)
#   ENCODING="euckr"               원본 인코딩 (utf8 이면 ENCODING=utf8)
#   OUT=./parcels-out              출력 폴더

set -euo pipefail

SRC="${1:-}"
if [[ -z "$SRC" || ! -f "$SRC" ]]; then
  echo "사용법: bash tools/extract-parcels.sh <연속지적도.shp>" >&2
  exit 1
fi

SGG="${SGG:-43150 43750 43770 43800}"   # 제천 진천 음성 단양
SIMPLIFY="${SIMPLIFY:-40%}"
ENCODING="${ENCODING:-euckr}"
OUT="${OUT:-./parcels-out}"

if ! command -v mapshaper >/dev/null 2>&1; then
  echo "mapshaper가 없습니다.  npm install -g mapshaper" >&2
  exit 1
fi

# 대상 시군구 필터식 만들기 (PNU 앞 5자리)
FILTER=""
for code in $SGG; do
  [[ -n "$FILTER" ]] && FILTER="$FILTER || "
  FILTER="${FILTER}p5 == '${code}'"
done

mkdir -p "$OUT"
rm -f "$OUT"/*.json

echo "▶ 원본       : $SRC"
echo "▶ 대상 시군구 : $SGG"
echo "▶ 단순화     : $SIMPLIFY / 인코딩: $ENCODING"
echo

# 큰 파일이라 힙을 넉넉히
export NODE_OPTIONS="--max-old-space-size=8192"

mapshaper -i "$SRC" encoding="$ENCODING" \
  -each 'p5 = (PNU || "").substring(0,5)' \
  -filter "$FILTER" \
  -each '
    p = PNU;
    j = (JIBUN || "").replace(/[0-9\-\s]/g, "").replace(/^산/, "");
    emd = (PNU || "").substring(0,10);
  ' \
  -filter-fields p,j,emd \
  -proj wgs84 \
  -simplify "$SIMPLIFY" keep-shapes \
  -clean \
  -split emd \
  -o "$OUT" format=geojson precision=0.000001 drop-table=false

# split 결과 파일명이 'emd-4315025300.json' 형태 → '4315025300.json' 로 정리
for f in "$OUT"/emd-*.json; do
  [[ -e "$f" ]] || continue
  mv "$f" "$OUT/$(basename "$f" | sed 's/^emd-//')"
done

node "$(dirname "$0")/make-manifest.mjs" "$OUT"

echo
echo "✔ 완료 → $OUT"
du -sh "$OUT"
echo "  파일 수: $(ls -1 "$OUT"/*.json | wc -l | tr -d ' ')"
echo
echo "다음: 이 폴더를 R2 버킷(예: parcel-data)에 업로드하고, 공개 URL을 알려주세요."
