// Figure 10 of Wu et al. (2026) normalizes TROPOMI residual albedo by a fixed
// 30 × 10⁻⁶ sr⁻¹ reference (CIPS uses 60 × 10⁻⁶ sr⁻¹ instead). Every place that
// turns a residual into a 0..1 detectionScore/color must share this constant,
// so a given residual value renders the same color in single-orbit and
// daily-mosaic views.
export const ARTICLE_TROPOMI_NORMALIZATION_SR = 30e-6;
