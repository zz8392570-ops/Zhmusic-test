#ifndef CYMUSIC_SOUND_DSP_H
#define CYMUSIC_SOUND_DSP_H

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

enum { CYDSPBandCount = 5, CYDSPMaxChannels = 8 };
extern const double CYDSPBandFrequencies[CYDSPBandCount];
typedef struct CYDSP CYDSP;

/* Creation/destruction allocate; never call them from the processing callback. */
CYDSP *CYDSPCreate(double sampleRate, unsigned channels);
void CYDSPDestroy(CYDSP *dsp);
/* Reset and all following calls belong to the same audio-processing thread. */
void CYDSPReset(CYDSP *dsp);
void CYDSPConfigure(CYDSP *dsp, bool enabled, const double bands[5], bool balance);
/* Normalized float PCM. Planar stride=1; interleaved channel pointers are offset
 * into one buffer and stride=channel count. No allocation, locks or I/O. */
void CYDSPProcess(CYDSP *dsp, float **channels, unsigned frames, unsigned stride);

#ifdef __cplusplus
}
#endif
#endif
