# AI SDK - MiniMax AI Provider

The **[MiniMax AI Provider](https://ai-sdk.dev/providers/community-providers/minimax)** for the [AI SDK](https://ai-sdk.dev/docs) contains language, image, speech, and video model support for the [MiniMax](https://www.minimax.io/) platform.

## Available Models

### Language

- **MiniMax-M2**: Agentic capabilities, Advanced reasoning
- **MiniMax-M2-Stable**: High concurrency and commercial use

Both models share the same API interface and usage patterns.

### Image, Speech & Video

- **Image**: `image-01`, `image-01-live` (text-to-image and image-to-image)
- **Speech**: `speech-2.8-hd`/`-turbo`, `speech-2.6-hd`/`-turbo`, `speech-02-hd`/`-turbo` (text-to-speech)
- **Video**: `MiniMax-Hailuo-2.3`, `MiniMax-Hailuo-02` (text/image-to-video), `MiniMax-Hailuo-2.3-Fast` (image-to-video)

See [Image, Speech & Video](#image-speech--video) below for usage.

## Setup

```bash
npm i vercel-minimax-ai-provider
```

## Provider Instance

You can import the default provider instance `minimax` from `vercel-minimax-ai-provider`:

```ts
import { minimax } from 'vercel-minimax-ai-provider';
```

> **Note**: The default `minimax` instance uses the Anthropic-compatible API format, which provides better support for advanced features. If you need the OpenAI-compatible format, use `minimaxOpenAI` instead.

## Example

```ts
import { minimax } from 'vercel-minimax-ai-provider';
import { generateText } from 'ai';

const { text } = await generateText({
  model: minimax('MiniMax-M2'),
  prompt: 'Write a JavaScript function that sorts a list:',
});
```

## API Compatibility

MiniMax provides two API compatibility modes, both included in this package:

### Anthropic-Compatible API (Default)

```ts
import { minimax } from 'vercel-minimax-ai-provider';
import { generateText } from 'ai';

const { text } = await generateText({
  model: minimax('MiniMax-M2'),
  prompt: 'Write a JavaScript function that sorts a list:',
});
```

Or explicitly:

```ts
import { minimaxAnthropic } from 'vercel-minimax-ai-provider';
import { generateText } from 'ai';

const { text } = await generateText({
  model: minimaxAnthropic('MiniMax-M2'),
  prompt: 'Write a JavaScript function that sorts a list:',
});
```

### OpenAI-Compatible API

```ts
import { minimaxOpenAI } from 'vercel-minimax-ai-provider';
import { generateText } from 'ai';

const { text } = await generateText({
  model: minimaxOpenAI('MiniMax-M2'),
  prompt: 'Write a JavaScript function that sorts a list:',
});
```

### Using MiniMax-M2-Stable

```ts
import { minimax } from 'vercel-minimax-ai-provider';
import { generateText } from 'ai';

const { text } = await generateText({
  model: minimax('MiniMax-M2-Stable'),
  prompt: 'Write a JavaScript function that sorts a list:',
});
```

## Image, Speech & Video

Beyond text, **both** provider instances (`minimax` and `minimaxOpenAI`) expose
MiniMax's native image, speech (text-to-speech), and video models. These use
MiniMax's own `/v1` endpoints (independent of the Anthropic/OpenAI text-compatibility
modes), so they behave identically on either instance — the examples below use
the default `minimax`, but `minimaxOpenAI.image(...)` etc. work the same.

### Image generation

```ts
import { minimax } from 'vercel-minimax-ai-provider';
import { experimental_generateImage as generateImage } from 'ai';

const { images } = await generateImage({
  model: minimax.image('image-01'),
  prompt: 'A serene mountain lake at sunrise',
  size: '1024x1024', // or aspectRatio: '16:9'
  n: 2,
  providerOptions: { minimax: { promptOptimizer: true } },
});
// images[0].uint8Array / images[0].base64
```

For image-to-image, pass the input image(s) via the structured `prompt` — the
AI SDK delivers them to the model and this provider maps them to MiniMax's
subject reference:

```ts
await generateImage({
  model: minimax.image('image-01'),
  prompt: {
    text: 'The same character riding a bicycle',
    images: [inputImage], // Uint8Array, base64 string, or a URL
  },
});
```

You can also pass the subject reference explicitly via provider options (this
overrides `prompt.images`):

```ts
await generateImage({
  model: minimax.image('image-01'),
  prompt: 'The same character riding a bicycle',
  providerOptions: {
    minimax: {
      subjectReference: [
        { type: 'character', image_file: 'https://example.com/face.jpg' },
      ],
    },
  },
});
```

### Speech (text-to-speech)

```ts
import { minimax } from 'vercel-minimax-ai-provider';
import { experimental_generateSpeech as generateSpeech } from 'ai';

const { audio } = await generateSpeech({
  model: minimax.speech('speech-2.6-hd'),
  text: '你好，欢迎使用 MiniMax 语音合成。',
  voice: 'male-qn-qingse', // MiniMax requires a voice_id; a default is used if omitted
  outputFormat: 'mp3',
  language: 'zh', // ISO 639-1 code, mapped to MiniMax's language_boost
  providerOptions: { minimax: { emotion: 'happy', sampleRate: 32000 } },
});
// audio.uint8Array
```

> MiniMax returns the audio as a hex-encoded payload which this provider decodes
> to bytes for you. Voice IDs come from MiniMax's voice catalogue — see the
> [T2A docs](https://platform.minimaxi.com/docs/api-reference/speech-t2a-http).

### Video generation

```ts
import { minimax } from 'vercel-minimax-ai-provider';
import { experimental_generateVideo as generateVideo } from 'ai';

const { videos } = await generateVideo({
  model: minimax.video('MiniMax-Hailuo-2.3'),
  prompt: 'A dog running through a field of flowers',
  duration: 6, // 6 or 10
  resolution: '1920x1080', // best-effort mapped to a MiniMax label (768P / 1080P)
  providerOptions: {
    minimax: {
      // Or set the MiniMax label directly (takes precedence): '512P' | '768P' | '1080P'
      // resolution: '1080P',
      pollIntervalMs: 5000,
      pollTimeoutMs: 600000,
    },
  },
});
// videos[0] is a URL-backed video
```

Video generation is asynchronous: the model creates a task, polls until it
completes, and returns the final video URL. For image-to-video, pass an `image`
(the first frame). Note that `MiniMax-Hailuo-2.3-Fast` is **image-to-video only**
— it is not valid for text-to-video.

```ts
await generateVideo({
  model: minimax.video('MiniMax-Hailuo-2.3-Fast'),
  prompt: 'Animate this photo with a gentle zoom',
  image: 'https://example.com/first-frame.jpg',
});
```

## Documentation

Please check out the **[MiniMax provider](https://ai-sdk.dev/providers/community-providers/minimax)** for more information.

