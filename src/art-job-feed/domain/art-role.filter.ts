const TARGET_TERMS = /원화|컨셉|콘셉트|concept/i;
const EXCLUDED_TERMS =
  /3D|모델링|모델러|애니메이터|애니메이션|VFX|이펙트|\bUI\b|\bUX\b|배경/i;

export const isTargetArtRole = (title: string): boolean => {
  if (!TARGET_TERMS.test(title)) {
    return false;
  }
  if (/캐릭터/i.test(title) && TARGET_TERMS.test(title)) {
    return true;
  }
  return !EXCLUDED_TERMS.test(title);
};
