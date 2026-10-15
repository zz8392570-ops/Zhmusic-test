/* Pure C DSP; the .m suffix lets the existing native pod source glob include it. */
#include "CyMusicSoundDSP.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>

const double CYDSPBandFrequencies[CYDSPBandCount] = {60, 230, 910, 3600, 14000};
static const double CYPI = 3.14159265358979323846;

typedef struct { double b0, b1, b2, a1, a2; } CYBiquad;
typedef struct { double z1, z2; } CYHistory;

struct CYDSP {
  double sampleRate;
  unsigned channels;
  bool enabled, balance, bypass;
  double target[5], current[5];
  CYBiquad filters[5];
  CYHistory histories[8][5];
  unsigned updateCountdown;
  double coefficientStep, headroomStep, rmsAttack, rmsRelease;
  double balanceAttack, balanceRelease, peakRelease;
  double headroomTarget, headroomGain, power, balanceGain, peakGain;
};

static double stepFor(double rate, double seconds) {
  return -expm1(-1.0 / (rate * seconds));
}

static CYBiquad coefficients(double rate, unsigned band, double gain) {
  CYBiquad result = {1, 0, 0, 0, 0};
  const double frequency = CYDSPBandFrequencies[band];
  if (fabs(gain) < 0.000001 || frequency >= rate * 0.49) return result;
  const double w = 2.0 * CYPI * frequency / rate;
  const double alpha = sin(w) / 2.0; /* Constant Q = 1. */
  const double a = pow(10.0, gain / 40.0);
  const double divisor = 1.0 + alpha / a;
  result.b0 = (1.0 + alpha * a) / divisor;
  result.b1 = -2.0 * cos(w) / divisor;
  result.b2 = (1.0 - alpha * a) / divisor;
  result.a1 = result.b1;
  result.a2 = (1.0 - alpha / a) / divisor;
  return result;
}

static double response(const CYBiquad filters[5], double w) {
  const double c1 = cos(w), s1 = sin(w), c2 = cos(2 * w), s2 = sin(2 * w);
  double squared = 1;
  for (unsigned b = 0; b < 5; b++) {
    const CYBiquad f = filters[b];
    const double nr = f.b0 + f.b1 * c1 + f.b2 * c2;
    const double ni = f.b1 * s1 + f.b2 * s2;
    const double dr = 1 + f.a1 * c1 + f.a2 * c2;
    const double di = f.a1 * s1 + f.a2 * s2;
    squared *= (nr * nr + ni * ni) / fmax(1e-30, dr * dr + di * di);
  }
  return sqrt(squared);
}

static double headroomFor(CYDSP *dsp) {
  CYBiquad filters[5];
  for (unsigned b = 0; b < 5; b++) filters[b] = coefficients(dsp->sampleRate, b, dsp->target[b]);
  double maximum = 1;
  /* Inspect the combined response, including exact band centers. This reserve
   * covers steady-state boosts; the linked peak controller also catches transients. */
  for (unsigned i = 0; i < 256; i++) {
    const double hz = 10.0 * pow(dsp->sampleRate * 0.049, (double)i / 255.0);
    maximum = fmax(maximum, response(filters, 2.0 * CYPI * hz / dsp->sampleRate));
  }
  for (unsigned b = 0; b < 5; b++) {
    if (CYDSPBandFrequencies[b] < dsp->sampleRate * 0.49)
      maximum = fmax(maximum, response(filters, 2.0 * CYPI * CYDSPBandFrequencies[b] / dsp->sampleRate));
  }
  return maximum > 1.00001 ? pow(10.0, -1.0 / 20.0) / maximum : 1.0;
}

CYDSP *CYDSPCreate(double sampleRate, unsigned channels) {
  if (!isfinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000 || channels < 1 || channels > 8)
    return NULL;
  CYDSP *dsp = calloc(1, sizeof(*dsp));
  if (!dsp) return NULL;
  dsp->sampleRate = sampleRate;
  dsp->channels = channels;
  dsp->coefficientStep = -expm1(-32.0 / (sampleRate * 0.02));
  dsp->headroomStep = stepFor(sampleRate, 0.02);
  dsp->rmsAttack = stepFor(sampleRate, 0.10);
  dsp->rmsRelease = stepFor(sampleRate, 1.5);
  dsp->balanceAttack = stepFor(sampleRate, 0.05);
  dsp->balanceRelease = stepFor(sampleRate, 1.5);
  dsp->peakRelease = stepFor(sampleRate, 0.30);
  dsp->bypass = true;
  dsp->headroomTarget = 1;
  CYDSPReset(dsp);
  return dsp;
}

void CYDSPDestroy(CYDSP *dsp) { free(dsp); }

void CYDSPReset(CYDSP *dsp) {
  if (!dsp) return;
  memset(dsp->histories, 0, sizeof(dsp->histories));
  dsp->power = 0;
  dsp->balanceGain = dsp->peakGain = 1;
  dsp->headroomGain = dsp->headroomTarget;
  dsp->updateCountdown = 0;
  for (unsigned b = 0; b < 5; b++) {
    dsp->current[b] = dsp->target[b];
    dsp->filters[b] = coefficients(dsp->sampleRate, b, dsp->current[b]);
  }
}

void CYDSPConfigure(CYDSP *dsp, bool enabled, const double bands[5], bool balance) {
  if (!dsp) return;
  bool changed = false, flat = true;
  const bool wasBypassed = dsp->bypass;
  for (unsigned b = 0; b < 5; b++) {
    const double supplied = bands ? bands[b] : 0;
    const double gain = enabled && isfinite(supplied) ? fmax(-6, fmin(6, supplied)) : 0;
    if (gain != dsp->target[b]) changed = true;
    dsp->target[b] = gain;
    if (gain != 0) flat = false;
  }
  dsp->enabled = enabled;
  dsp->balance = balance;
  dsp->bypass = (!enabled || flat) && !balance;
  if (changed) dsp->headroomTarget = headroomFor(dsp);
  if (dsp->bypass || wasBypassed) CYDSPReset(dsp);
}

void CYDSPProcess(CYDSP *dsp, float **channels, unsigned frames, unsigned stride) {
  if (!dsp || dsp->bypass || !channels || stride == 0) return;
  for (unsigned c = 0; c < dsp->channels; c++) if (!channels[c]) return;
  const double targetRMS = 0.12589254117941673; /* -18 dBFS RMS, not LUFS. */
  const double minimumBalance = 0.12589254117941673; /* At most 18 dB attenuation. */
  for (unsigned frame = 0; frame < frames; frame++) {
    if (dsp->updateCountdown == 0) {
      for (unsigned b = 0; b < 5; b++) {
        const double difference = dsp->target[b] - dsp->current[b];
        if (difference == 0) continue;
        if (fabs(difference) < 0.00001) dsp->current[b] = dsp->target[b];
        else dsp->current[b] += difference * dsp->coefficientStep;
        dsp->filters[b] = coefficients(dsp->sampleRate, b, dsp->current[b]);
      }
      dsp->updateCountdown = 32;
    }
    dsp->updateCountdown--;
    dsp->headroomGain += (dsp->headroomTarget - dsp->headroomGain) * dsp->headroomStep;
    double values[8], energy = 0;
    for (unsigned c = 0; c < dsp->channels; c++) {
      double x = channels[c][(size_t)frame * stride];
      if (!isfinite(x)) x = 0;
      x = fmax(-8, fmin(8, x));
      for (unsigned b = 0; b < 5; b++) {
        const CYBiquad f = dsp->filters[b];
        CYHistory *h = &dsp->histories[c][b];
        const double y = f.b0 * x + h->z1;
        h->z1 = f.b1 * x - f.a1 * y + h->z2;
        h->z2 = f.b2 * x - f.a2 * y;
        if (fabs(h->z1) < 1e-30) h->z1 = 0;
        if (fabs(h->z2) < 1e-30) h->z2 = 0;
        x = y;
      }
      values[c] = x * dsp->headroomGain;
      energy += values[c] * values[c];
    }
    energy /= dsp->channels;
    dsp->power += (energy - dsp->power) * (energy > dsp->power ? dsp->rmsAttack : dsp->rmsRelease);
    double wantedBalance = 1;
    if (dsp->balance && dsp->power > 1e-20)
      wantedBalance = fmax(minimumBalance, fmin(1, targetRMS / sqrt(dsp->power)));
    dsp->balanceGain += (wantedBalance - dsp->balanceGain) *
      (wantedBalance < dsp->balanceGain ? dsp->balanceAttack : dsp->balanceRelease);
    double peak = 0;
    for (unsigned c = 0; c < dsp->channels; c++) {
      values[c] *= dsp->balanceGain;
      peak = fmax(peak, fabs(values[c]));
    }
    const double wantedPeak = peak > 0.98 ? 0.98 / peak : 1;
    if (wantedPeak < dsp->peakGain) dsp->peakGain = wantedPeak;
    else dsp->peakGain = fmin(wantedPeak, dsp->peakGain + (1 - dsp->peakGain) * dsp->peakRelease);
    for (unsigned c = 0; c < dsp->channels; c++)
      channels[c][(size_t)frame * stride] = (float)(values[c] * dsp->peakGain);
  }
}
