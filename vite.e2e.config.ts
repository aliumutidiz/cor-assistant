import { mergeConfig, defineConfig } from 'vite';
import base from './vite.config.ts';
export default mergeConfig(base, defineConfig({ server: { proxy: { '/api': 'http://127.0.0.1:3101' } } }));
