"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PAGE_LIMIT = void 0;
/** The largest page any list of `/v1` answers. A page asked to be bigger gets this rather than a refusal; the rest follows from `nextCursor`. */
exports.MAX_PAGE_LIMIT = 200;
