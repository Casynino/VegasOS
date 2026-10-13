// For running the practice-day loader (scripts/test-scenario.ts) outside the app: the services it uses now reach
// "next/navigation" (page redirects), which cannot load outside a page. Nothing in the loader ever redirects, so it
// gets stand-ins that say so if they are ever called.
//   NODE_OPTIONS="--conditions=react-server --require ./guides/tools/stub-next.cjs"
const Module = require("node:module");

const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === "next/navigation" ? __filename : resolve.call(this, request, ...rest);
};

const pageOnly = (name) => () => { throw new Error(`${name}() only works inside a page.`); };
module.exports = Object.fromEntries(
  ["redirect", "permanentRedirect", "notFound", "forbidden", "unauthorized", "useRouter", "usePathname", "useSearchParams", "useParams"].map((n) => [n, pageOnly(n)]),
);
