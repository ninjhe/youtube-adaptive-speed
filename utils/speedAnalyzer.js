/**
 * Speaking Pace Analyzer Module
 * Calculates words per second from transcript segments
 */

const SpeedAnalyzer = {
    // Average human speaking pace: ~150 words/minute = 2.5 words/second
    BASELINE_WORDS_PER_SEC: 2.45,

    // Number of segments to analyze (look ahead from current position)
    LOOKAHEAD_SEGMENTS: 12,

    // Minimum words in a segment to count (filters out single-word transitions)
    MIN_WORDS_THRESHOLD: 2,

    // Minimum segment duration to consider (seconds)
    MIN_DURATION_THRESHOLD: 0.3,

    /**
     * Analyzes transcript segments ahead of the current time
     * @param {Array} segments - All transcript segments
     * @param {number} currentTime - Current video playback time in seconds
     * @returns {{wordsPerSec: number, recommendedSpeed: number, segmentsAnalyzed: number}}
     */
    analyze(segments, currentTime) {
        if (!segments || segments.length === 0) {
            return { wordsPerSec: this.BASELINE_WORDS_PER_SEC, recommendedSpeed: 1.0, segmentsAnalyzed: 0 };
        }

        // Get next N segments after current time
        let upcomingSegments = this.getUpcomingSegments(segments, currentTime);

        // Filter out segments that are just "[Music]"
        upcomingSegments = upcomingSegments.filter(seg => {
            const text = seg.text ? seg.text.trim() : '';
            return text !== '[Music]' && text !== '[music]';
        });

        if (upcomingSegments.length === 0) {
            return { wordsPerSec: this.BASELINE_WORDS_PER_SEC, recommendedSpeed: 1.0, segmentsAnalyzed: 0 };
        }

        // Calculate total words and duration from these segments
        const { totalWords, totalDuration } = this.calculateWordStats(upcomingSegments);

        if (totalDuration === 0) {
            return { wordsPerSec: this.BASELINE_WORDS_PER_SEC, recommendedSpeed: 1.0, segmentsAnalyzed: 0 };
        }

        const wordsPerSec = totalWords / totalDuration;
        const recommendedSpeed = this.calculateRecommendedSpeed(wordsPerSec);

        // Detailed logging for debugging
        AdaptiveSpeedDebug.log('Segments being analyzed:');
        upcomingSegments.forEach((seg, i) => {
            // Count words (split by whitespace OR hyphens, as requested)
            const wordCount = seg.text.split(/[-\s]+/).filter(w => w.length > 0).length;
            AdaptiveSpeedDebug.log(`  ${i + 1}. start=${seg.start.toFixed(1)}s, dur=${seg.duration.toFixed(1)}s, words=${wordCount}, text="${seg.text.substring(0, 50)}..."`);
        });

        AdaptiveSpeedDebug.log(`Analysis: ${wordsPerSec.toFixed(2)} words/sec, ` +
            `recommended speed: ${recommendedSpeed.toFixed(2)}x (raw, before clamping) ` +
            `(${upcomingSegments.length} segments, ${totalWords} words, ${totalDuration.toFixed(1)}s)`);

        return {
            wordsPerSec,
            recommendedSpeed,
            segmentsAnalyzed: upcomingSegments.length
        };
    },

    /**
     * Gets the next N segments after the current playback time
     */
    getUpcomingSegments(segments, currentTime) {
        // Find the first segment that starts after current time
        let startIndex = 0;
        for (let i = 0; i < segments.length; i++) {
            if (segments[i].start >= currentTime) {
                startIndex = i;
                break;
            }
            // If we've passed all segments, use the last few
            if (i === segments.length - 1) {
                startIndex = Math.max(0, segments.length - this.LOOKAHEAD_SEGMENTS);
            }
        }

        // Get the next N segments
        const endIndex = Math.min(segments.length, startIndex + this.LOOKAHEAD_SEGMENTS);
        return segments.slice(startIndex, endIndex);
    },

    /**
     * Calculates total words and duration from segments
     * Uses EFFECTIVE duration: min(raw_duration, next_segment_start - this_segment_start)
     * This prevents overlapping segments from double-counting time while still
     * handling gaps in multi-language videos (where gap = no translation)
     */
    calculateWordStats(segments) {
        if (segments.length === 0) {
            return { totalWords: 0, totalDuration: 0 };
        }

        let totalWords = 0;
        let totalDuration = 0;

        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];

            // Count words (split by whitespace OR hyphens)
            const words = segment.text.split(/[-\s]+/).filter(w => w.length > 0);
            totalWords += words.length;

            // Calculate effective duration:
            // If there's a next segment, use min(raw_duration, gap_to_next)
            // This prevents overlapping captions from double-counting time
            let effectiveDuration = segment.duration;

            if (i < segments.length - 1) {
                const nextSegment = segments[i + 1];
                const gapToNext = nextSegment.start - segment.start;

                // Use the smaller of: raw duration or gap to next segment
                if (gapToNext > 0 && gapToNext < effectiveDuration) {
                    effectiveDuration = gapToNext;
                }
            }

            totalDuration += effectiveDuration;
        }

        // Ensure we have a valid duration (avoid division by zero)
        if (totalDuration <= 0) {
            return { totalWords, totalDuration: 1 };
        }

        return { totalWords, totalDuration };
    },

    /**
     * Calculates the recommended playback speed based on speaking pace
     * 
     * Logic:
     * - If speaker talks at baseline pace (2.5 words/sec), keep at 1.0x
     * - If speaker talks slower, speed up to normalize
     * - If speaker talks faster, keep at 1.0x (don't slow down below 1.0)
     * 
     * Formula: recommendedSpeed = BASELINE / actualPace
     * - If actual = 2.0 words/sec (slow), recommend 2.5/2.0 = 1.25x
     * - If actual = 2.5 words/sec (normal), recommend 2.5/2.5 = 1.0x
     * - If actual = 3.0 words/sec (fast), recommend 2.5/3.0 = 0.83x → clamped later
     */
    calculateRecommendedSpeed(wordsPerSec) {
        if (wordsPerSec <= 0) return 1.0;

        // Calculate raw recommended speed (NOT clamped here - content.js clamps after applying multiplier)
        let speed = this.BASELINE_WORDS_PER_SEC / wordsPerSec;

        // Round to 0.05 increments
        speed = Math.round(speed * 20) / 20;

        return speed;
    },


};

// Make available globally for content script
window.SpeedAnalyzer = SpeedAnalyzer;
