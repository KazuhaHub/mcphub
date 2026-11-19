// react-router needs TextEncoder at import time, which jsdom lacks. Import this before it.
import { TextDecoder, TextEncoder } from 'util';

Object.assign(globalThis, { TextEncoder, TextDecoder });
