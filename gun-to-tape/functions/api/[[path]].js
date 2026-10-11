import { handle } from '../_lib/api.js';

export const onRequest = (context) => handle(context.request, context.env);
