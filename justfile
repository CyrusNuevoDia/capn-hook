set dotenv-load := true

fmt:
    bun x ultracite fix

lint:
    bun x @typescript/native-preview@beta --noEmit --pretty false --types bun --module esnext --moduleResolution bundler src/capn.ts tests/capn.test.ts
    bun x ultracite check
