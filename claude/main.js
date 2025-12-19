// n8n Code Node - Whisper Transcription Data Processor
// Processes Whisper API transcription output with segments and word-level timing
// Compatible with n8n workflow automation

// Get input data from n8n
const items = $input.all();

function processTranscriptionData(data) {
  // Extract main text
  const fullText = data.text || '';

  // Process segments
  const segments = (data.segments || []).map((segment, index) => {
    return {
      id: segment.id || index,
      startTime: segment.start || 0,
      endTime: segment.end || 0,
      duration: (segment.end || 0) - (segment.start || 0),
      text: segment.text || '',

      // Include word-level data for karaoke subtitles (preserve original structure)
      words: segment.words || [],

      // Confidence metrics
      avgLogProb: segment.avg_logprob || 0,
      noSpeechProb: segment.no_speech_prob || 0,
      temperature: segment.temperature || 0,
      compressionRatio: segment.compression_ratio || 0,

      // Word count and timing analysis
      wordCount: (segment.words || []).length,
      wordsPerSecond: segment.words ?
        segment.words.length / ((segment.end || 0) - (segment.start || 0) || 1) : 0,

      // Extract high-confidence words (probability > 0.8)
      highConfidenceWords: (segment.words || []).filter(word =>
        (word.probability || 0) > 0.8
      ).map(word => word.word).join(' '),

      // Extract low-confidence words (probability < 0.5) for review
      lowConfidenceWords: (segment.words || []).filter(word =>
        (word.probability || 0) < 0.5
      ).map(word => ({
        word: word.word,
        probability: word.probability,
        start: word.start,
        end: word.end
      }))
    };
  });

  // Generate summary statistics
  const stats = {
    totalDuration: segments.length > 0 ?
      Math.max(...segments.map(s => s.endTime)) : 0,
    totalSegments: segments.length,
    totalWords: segments.reduce((sum, seg) => sum + seg.wordCount, 0),
    averageConfidence: segments.length > 0 ?
      segments.reduce((sum, seg) => sum + Math.abs(seg.avgLogProb), 0) / segments.length : 0,
    languageDetected: data.language || 'unknown',

    // Identify segments with potential issues
    lowConfidenceSegments: segments.filter(seg => seg.avgLogProb < -0.5).length,
    highNoSpeechSegments: segments.filter(seg => seg.noSpeechProb > 0.1).length
  };

  // Extract timestamps for easy navigation
  const timeMarkers = segments.map(segment => ({
    segmentId: segment.id,
    timestamp: segment.startTime,
    text: segment.text.substring(0, 50) + (segment.text.length > 50 ? '...' : ''),
    confidence: Math.abs(segment.avgLogProb)
  }));

  // Generate cleaned transcript (remove filler words, fix spacing) - optimized
  const cleanedText = fullText.length > 100000 ?
    fullText.replace(/\s+/g, ' ').trim() : // Skip expensive regex for very large texts
    fullText
      .replace(/\s+/g, ' ')  // Multiple spaces to single
      .replace(/\b(um|uh|er|ah)\b/gi, '')  // Remove common filler words
      .replace(/\s+/g, ' ')  // Clean up spaces after filler removal
      .trim();

  // Split into paragraphs based on longer pauses (gaps > 2 seconds)
  const paragraphs = [];
  let currentParagraph = [];

  for (let i = 0; i < segments.length; i++) {
    const currentSegment = segments[i];
    const nextSegment = segments[i + 1];

    currentParagraph.push(currentSegment.text.trim());

    // End paragraph if there's a significant pause or it's the last segment
    if (!nextSegment || (nextSegment.startTime - currentSegment.endTime) > 2) {
      if (currentParagraph.length > 0) {
        paragraphs.push(currentParagraph.join(' ').trim());
        currentParagraph = [];
      }
    }
  }

  return {
    // Original data
    originalText: fullText,
    language: data.language,

    // Processed data
    cleanedText,
    paragraphs,
    segments,

    // Analytics
    statistics: stats,
    timeMarkers,

    // For further processing
    exportFormats: {
      srt: generateSRT(segments),
      vtt: generateVTT(segments),
      ass: generateASS(segments),
      plainText: cleanedText,
      wordTimings: extractWordTimings(segments)
    }
  };
}

// Generate SRT subtitle format
function generateSRT(segments) {
  return segments.map((segment, index) => {
    const startTime = formatTime(segment.startTime);
    const endTime = formatTime(segment.endTime);
    return `${index + 1}\n${startTime} --> ${endTime}\n${segment.text.trim()}\n`;
  }).join('\n');
}

// Generate WebVTT subtitle format
function generateVTT(segments) {
  const vttHeader = 'WEBVTT\n\n';
  const vttContent = segments.map((segment, index) => {
    const startTime = formatTime(segment.startTime, true);
    const endTime = formatTime(segment.endTime, true);
    return `${startTime} --> ${endTime}\n${segment.text.trim()}\n`;
  }).join('\n');
  return vttHeader + vttContent;
}

// Generate ASS subtitle format with karaoke-style word-by-word timing - memory optimized
function generateASS(segments) {
  const assHeader = `[Script Info]
Title: Karaoke Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.601
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,84,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,4,5,50,50,50,1
Style: Karaoke,Arial,84,&H0000FFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,4,5,50,50,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // Ensure we have segments to process
  if (!segments || segments.length === 0) {
    return assHeader + 'Dialogue: 0,0:00:00.00,0:00:01.00,Karaoke,,0,0,0,,No data available\n';
  }

  const assEvents = [];
  const MAX_EVENTS = 5000; // Prevent memory overflow
  let eventCount = 0;

  for (const segment of segments) {
    if (eventCount >= MAX_EVENTS) break;

    if (segment.words && segment.words.length > 0) {
      // Create karaoke-style word-by-word events using word-level timing
      for (const word of segment.words) {
        if (eventCount >= MAX_EVENTS) break;

        const startTime = formatASSTime(word.start || segment.startTime || segment.start || 0);
        const endTime = formatASSTime(word.end || segment.endTime || segment.end || 0);
        const cleanWord = (word.word || '').trim().replace(/\n/g, '\\N');

        if (cleanWord) {
          assEvents.push(`Dialogue: 0,${startTime},${endTime},Karaoke,,0,0,0,,${cleanWord}`);
          eventCount++;
        }
      }
    } else if (segment.text) {
      // Fallback: split text by words if no word-level timing available
      const words = segment.text.trim().split(/\s+/);
      const segmentDuration = (segment.endTime || segment.end || 0) - (segment.startTime || segment.start || 0);
      const timePerWord = segmentDuration > 0 ? segmentDuration / words.length : 1;

      for (let index = 0; index < words.length && eventCount < MAX_EVENTS; index++) {
        const word = words[index];
        const wordStart = (segment.startTime || segment.start || 0) + (index * timePerWord);
        const wordEnd = (segment.startTime || segment.start || 0) + ((index + 1) * timePerWord);
        const startTime = formatASSTime(wordStart);
        const endTime = formatASSTime(wordEnd);
        const cleanWord = word.replace(/\n/g, '\\N');

        if (cleanWord) {
          assEvents.push(`Dialogue: 0,${startTime},${endTime},Karaoke,,0,0,0,,${cleanWord}`);
          eventCount++;
        }
      }
    }
  }

  // Ensure we have at least some content
  if (assEvents.length === 0) {
    assEvents.push('Dialogue: 0,0:00:00.00,0:00:01.00,Karaoke,,0,0,0,,Processing error - no dialogue generated');
  }

  return assHeader + assEvents.join('\n');
}

// Format time for ASS subtitles (H:MM:SS.cc)
function formatASSTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const centiseconds = Math.floor((seconds % 1) * 100);

  return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
}

// Format time for subtitles (HH:MM:SS,mmm for SRT, HH:MM:SS.mmm for VTT)
function formatTime(seconds, isVTT = false) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  const separator = isVTT ? '.' : ',';
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}${separator}${ms.toString().padStart(3, '0')}`;
}

// Extract word-level timings with memory optimization
function extractWordTimings(segments) {
  const MAX_WORDS = 10000; // Prevent memory overflow
  const wordTimings = [];
  let wordCount = 0;

  for (const segment of segments) {
    if (segment.words) {
      for (const word of segment.words) {
        if (wordCount >= MAX_WORDS) break;

        wordTimings.push({
          word: word.word?.trim(),
          start: word.start,
          end: word.end,
          duration: (word.end || 0) - (word.start || 0),
          probability: word.probability,
          segmentId: segment.id
        });
        wordCount++;
      }
    }
    if (wordCount >= MAX_WORDS) break;
  }

  return wordTimings;
}

// Process all input items for n8n - memory optimized with batching
function processItemsBatched(items, batchSize = 10) {
  const processedItems = [];
  const startTime = Date.now();

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    const batchResults = batch.map(item => {
      try {
        // Handle different input structures
        let transcriptionData;

        // Check if data is in binary format first
        if (item.binary && item.binary.data) {
          // If it's binary data, try to parse it
          try {
            const binaryData = item.binary.data;
            transcriptionData = JSON.parse(binaryData);
          } catch (e) {
            console.log('Failed to parse binary data:', e);
            transcriptionData = item.json || item;
          }
        } else if (item.json) {
          // Extract data directly from n8n json structure
          transcriptionData = item.json.data || item.json;
        } else {
          transcriptionData = item;
        }

        // Handle array structure from file input (like video.json)
        if (Array.isArray(transcriptionData) && transcriptionData.length > 0) {
          // Extract the data object from the first array element
          transcriptionData = transcriptionData[0].data || transcriptionData[0];
        }

        // Process the transcription data
        const processed = processTranscriptionData(transcriptionData);

        return {
          json: {
            success: true,
            processed: processed,
            metadata: {
              processedAt: new Date().toISOString(),
              processingTime: Date.now() - startTime,
              inputType: 'whisper-transcription',
              batchIndex: Math.floor(i / batchSize)
            }
          }
        };

      } catch (error) {
        return {
          json: {
            success: false,
            error: error.message,
            originalData: null, // Don't store original data to save memory
            metadata: {
              processedAt: new Date().toISOString(),
              inputType: 'error',
              batchIndex: Math.floor(i / batchSize)
            }
          }
        };
      }
    });

    processedItems.push(...batchResults);

    // Force garbage collection hint between batches for large datasets
    if (items.length > 100 && i % 50 === 0) {
      // Allow event loop to process other tasks
      if (typeof setImmediate !== 'undefined') {
        setImmediate(() => {});
      }
    }
  }

  return processedItems;
}

// Process items with memory optimization
const processedItems = processItemsBatched(items);

// Return processed items for n8n
return processedItems;