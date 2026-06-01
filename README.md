# AI SDK - MiniMax AI Provider

The **[MiniMax AI Provider](https://ai-sdk.dev/providers/community-providers/minimax)** for the [AI SDK](https://ai-sdk.dev/docs) contains language model support for the [MiniMax](https://www.minimax.io/) platform.

## Available Models

- **MiniMax-M3**: Flagship model — 512K context, native multimodal (text + image), advanced reasoning
- **MiniMax-M2.7**: Enhanced reasoning and coding for low-cost, high-throughput use
- **MiniMax-M2.7-highspeed**: High-speed variant of M2.7 for low-latency scenarios
- **MiniMax-M2**: Agentic capabilities, Advanced reasoning
- **MiniMax-M2-Stable**: High concurrency and commercial use

All models are accessed through the same provider interface, but their
capabilities and pricing differ (for example, only M3 accepts image input).
See the [MiniMax pricing docs](https://platform.minimax.io/docs/guides/pricing-paygo)
for per-model details.

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

## Documentation

Please check out the **[MiniMax provider](https://ai-sdk.dev/providers/community-providers/minimax)** for more information.

