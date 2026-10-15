#include "CyMusicSoundDSP.h"
#include <float.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned checks = 0;
static const double pi = 3.14159265358979323846;
#define REQUIRE(condition, message) do { checks++; if (!(condition)) { \
  fprintf(stderr, "FAIL %s (line %d)\n", message, __LINE__); exit(1); } } while (0)

static float *allocate(unsigned frames) {
  float *data = calloc(frames, sizeof(float));
  REQUIRE(data != NULL, "sample allocation");
  return data;
}

static void tone(float *data, unsigned frames, double rate, double hz, double amplitude) {
  for (unsigned i = 0; i < frames; i++) data[i] = (float)(amplitude * sin(2 * pi * hz * i / rate));
}

static double rms(const float *data, unsigned start, unsigned frames) {
  double power = 0;
  for (unsigned i = start; i < frames; i++) power += (double)data[i] * data[i];
  return sqrt(power / (frames - start));
}

static void bypass(void) {
  float input[] = {0, -0.0f, 0.5f, -0.5f, 4, -4, FLT_MAX, NAN, INFINITY};
  float output[sizeof(input) / sizeof(*input)];
  memcpy(output, input, sizeof(input));
  float *channels[] = {output};
  CYDSP *dsp = CYDSPCreate(44100, 1);
  REQUIRE(dsp != NULL, "valid create");
  const double gains[] = {6, 6, 6, 6, 6};
  CYDSPConfigure(dsp, false, gains, false);
  CYDSPProcess(dsp, channels, sizeof(input) / sizeof(*input), 1);
  REQUIRE(memcmp(input, output, sizeof(input)) == 0, "off is bit-exact including exceptional samples");
  const double flat[] = {0, 0, 0, 0, 0};
  CYDSPConfigure(dsp, true, flat, false);
  CYDSPProcess(dsp, channels, sizeof(input) / sizeof(*input), 1);
  REQUIRE(memcmp(input, output, sizeof(input)) == 0, "original preset is bit-exact");
  CYDSPDestroy(dsp);
  REQUIRE(CYDSPCreate(NAN, 2) == NULL, "reject invalid sample rate");
  REQUIRE(CYDSPCreate(44100, 0) == NULL, "reject empty channel layout");
  REQUIRE(CYDSPCreate(44100, 9) == NULL, "reject oversized channel layout");
  CYDSPDestroy(NULL);
  puts("PASS exact bypass and invalid configurations");
}

static double responseAt(double rate, unsigned band, double gain, double hz) {
  unsigned frames = (unsigned)(rate * 0.8);
  float *samples = allocate(frames);
  tone(samples, frames, rate, hz, 0.01);
  const double before = rms(samples, frames / 2, frames);
  CYDSP *dsp = CYDSPCreate(rate, 1);
  double gains[5] = {0};
  gains[band] = gain;
  CYDSPConfigure(dsp, true, gains, false);
  CYDSPProcess(dsp, &samples, frames, 1);
  const double result = rms(samples, frames / 2, frames) / before;
  CYDSPDestroy(dsp);
  free(samples);
  return result;
}

static void frequencyResponse(void) {
  const double rates[] = {44100, 48000, 96000, 192000};
  for (unsigned r = 0; r < 4; r++) for (unsigned b = 0; b < 5; b++) {
    const double center = CYDSPBandFrequencies[b];
    for (int sign = -1; sign <= 1; sign += 2) {
      const double peak = responseAt(rates[r], b, sign * 6, center);
      const double distant = responseAt(rates[r], b, sign * 6, center / 4);
      const double contrast = 20 * log10(peak / distant);
      REQUIRE(sign * contrast > 4.4 && sign * contrast < 6.8, "EQ changes its intended band at each sample rate");
    }
  }
  /* A band beyond Nyquist must not alias into an unrelated audible band. */
  REQUIRE(fabs(responseAt(8000, 4, 6, 1000) - 1) < 0.00001, "out-of-range band bypass");
  puts("PASS five-band sine frequency response across sample rates");
}

static void layoutsAndReset(void) {
  const unsigned n = 4096, channelCount = 8;
  float *planar[8], *interleaved[8];
  float *packed = allocate(n * channelCount);
  for (unsigned c = 0; c < channelCount; c++) {
    planar[c] = allocate(n);
    tone(planar[c], n, 48000, 600 + 100 * c, c ? 0 : 0.2);
    interleaved[c] = packed + c;
    for (unsigned i = 0; i < n; i++) packed[i * channelCount + c] = planar[c][i];
  }
  double bands[] = {4, -3, 6, -2, 3};
  CYDSP *a = CYDSPCreate(48000, 8), *b = CYDSPCreate(48000, 8);
  CYDSPConfigure(a, true, bands, true);
  CYDSPConfigure(b, true, bands, true);
  CYDSPProcess(a, planar, n, 1);
  CYDSPProcess(b, interleaved, n, channelCount);
  for (unsigned c = 0; c < channelCount; c++) for (unsigned i = 0; i < n; i++) {
    REQUIRE(planar[c][i] == packed[i * channelCount + c], "planar and interleaved output agree");
    if (c) REQUIRE(planar[c][i] == 0, "filter histories do not leak between channels");
  }
  CYDSPReset(a);
  CYDSP *fresh = CYDSPCreate(48000, 8);
  CYDSPConfigure(fresh, true, bands, true);
  for (unsigned c = 0; c < 8; c++) {
    tone(planar[c], n, 48000, 910, 0.1);
    for (unsigned i = 0; i < n; i++) packed[i * 8 + c] = planar[c][i];
  }
  CYDSPProcess(a, planar, n, 1);
  CYDSPProcess(fresh, interleaved, n, 8);
  for (unsigned c = 0; c < 8; c++) for (unsigned i = 0; i < n; i++)
    REQUIRE(planar[c][i] == packed[i * 8 + c], "reset matches a fresh configured processor");
  for (unsigned c = 0; c < 8; c++) free(planar[c]);
  CYDSPDestroy(a); CYDSPDestroy(b); CYDSPDestroy(fresh); free(packed);
  puts("PASS channel isolation, PCM layouts and reset");
}

static void balanceAndPeaks(void) {
  const unsigned n = 144000;
  float *left = allocate(n), *right = allocate(n);
  float *channels[] = {left, right};
  const double flat[] = {0, 0, 0, 0, 0};
  CYDSP *dsp = CYDSPCreate(48000, 2);
  CYDSPConfigure(dsp, true, flat, true);
  for (unsigned i = 0; i < n; i++) left[i] = right[i] = 0.5;
  CYDSPProcess(dsp, channels, n, 1);
  REQUIRE(fabs(rms(left, n * 2 / 3, n) - 0.1258925) < 0.003, "RMS balance attenuates loud input");
  /* EQ off must leave volume balancing independently active, ignoring saved EQ gains. */
  CYDSPReset(dsp);
  const double storedEQ[] = {6, 6, 6, 6, 6};
  CYDSPConfigure(dsp, false, storedEQ, true);
  for (unsigned i = 0; i < n; i++) left[i] = right[i] = 0.5;
  CYDSPProcess(dsp, channels, n, 1);
  REQUIRE(fabs(rms(left, n * 2 / 3, n) - 0.1258925) < 0.003, "balance works independently with EQ disabled");
  for (unsigned i = 1; i < n; i++) {
    REQUIRE(fabs(left[i] - left[i - 1]) < 0.001, "balance gain changes smoothly");
    REQUIRE(left[i] == right[i], "linked gain preserves identical-channel phase");
  }
  CYDSPReset(dsp);
  for (unsigned i = 0; i < n; i++) left[i] = right[i] = 0.001f;
  CYDSPProcess(dsp, channels, n, 1);
  for (unsigned i = 0; i < n; i++) REQUIRE(left[i] == 0.001f, "quiet input is never boosted");
  memset(left, 0, n * sizeof(float)); memset(right, 0, n * sizeof(float));
  CYDSPProcess(dsp, channels, n, 1);
  REQUIRE(rms(left, 0, n) == 0, "silence stays silent");
  const double boosted[] = {6, 6, 6, 6, 6};
  CYDSPConfigure(dsp, true, boosted, false); CYDSPReset(dsp);
  const float extreme[] = {FLT_MAX, -FLT_MAX, NAN, INFINITY, -INFINITY, 8, -8, 0.9f};
  for (unsigned i = 0; i < n; i++) { left[i] = extreme[i % 8]; right[i] = -left[i]; }
  CYDSPProcess(dsp, channels, n, 1);
  for (unsigned i = 0; i < n; i++) {
    REQUIRE(isfinite(left[i]) && fabs(left[i]) <= 0.980001, "extreme boosted input remains finite and peak-safe");
    REQUIRE(left[i] == -right[i], "linked processing preserves opposite-channel phase");
  }
  CYDSPConfigure(dsp, false, flat, false);
  CYDSPConfigure(dsp, true, flat, true);
  for (unsigned i = 0; i < n; i++) left[i] = right[i] = 0.1f;
  left[0] = right[0] = 8;
  CYDSPProcess(dsp, channels, n, 1);
  REQUIRE(fabs(left[0]) <= 0.980001, "peak protection attacks immediately");
  REQUIRE(left[1] < 0.02f && left[n - 1] > 0.099f, "peak release recovers gradually");
  CYDSPDestroy(dsp); free(left); free(right);
  puts("PASS RMS attenuation, silence, stereo phase and peak protection");
}

static void updatesAndChunks(void) {
  const unsigned n = 8192;
  float *one = allocate(n), *many = allocate(n);
  tone(one, n, 44100, 910, 0.2); memcpy(many, one, n * sizeof(float));
  double gains[] = {3, -2, 5, 1, -4};
  CYDSP *a = CYDSPCreate(44100, 1), *b = CYDSPCreate(44100, 1);
  CYDSPConfigure(a, true, gains, true); CYDSPConfigure(b, true, gains, true);
  CYDSPProcess(a, &one, n, 1);
  for (unsigned offset = 0; offset < n;) {
    unsigned count = offset % 113 + 1;
    if (offset + count > n) count = n - offset;
    float *part = many + offset;
    CYDSPConfigure(b, true, gains, true);
    CYDSPProcess(b, &part, count, 1);
    offset += count;
  }
  REQUIRE(memcmp(one, many, n * sizeof(float)) == 0, "buffer boundaries and repeated config do not reset processing");
  CYDSPReset(a);
  gains[2] = -6;
  tone(one, n, 44100, 910, 0.2);
  CYDSPConfigure(a, true, gains, true);
  CYDSPProcess(a, &one, n, 1);
  for (unsigned i = 1; i < n; i++)
    REQUIRE(isfinite(one[i]) && fabs(one[i] - one[i - 1]) < 0.1, "EQ parameter changes remain smooth");
  double invalid[] = {NAN, INFINITY, -INFINITY, 0, 0};
  CYDSPConfigure(a, true, invalid, false);
  for (unsigned i = 0; i < n; i++) one[i] = 3;
  CYDSPProcess(a, &one, n, 1);
  REQUIRE(one[0] == 3 && one[n - 1] == 3, "nonfinite settings sanitize to exact original preset");
  CYDSPDestroy(a); CYDSPDestroy(b); free(one); free(many);
  puts("PASS smooth settings updates and chunk-independent state");
}

int main(void) {
  bypass(); frequencyResponse(); layoutsAndReset(); balanceAndPeaks(); updatesAndChunks();
  printf("PASS native sound DSP: %u assertions\n", checks);
  return 0;
}
