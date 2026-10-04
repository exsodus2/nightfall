import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import ts from "typescript";

const args = new Map(process.argv.slice(2).map(argument => {
  const [key, ...value] = argument.replace(/^--/, "").split("=");
  return [key, value.join("=") || "true"];
}));
const root = process.cwd();
const directory = resolve(root, "artifacts", args.get("out") ?? "shader-startup");
const digest = source => createHash("sha256").update(source).digest("hex");
const materialsPath = resolve(root, "src/city/materials.ts");
const currentSource = readFileSync(materialsPath, "utf8");
const compareSpecialization = args.has("compare-specialization");
const compare = args.has("compare") || compareSpecialization;
assert.ok(!compareSpecialization || !args.has("baseline"), "--compare-specialization uses the same current source for both versions; omit --baseline");
const baselineRef = args.get("baseline") ?? "HEAD";
const headSource = compareSpecialization ? currentSource : execFileSync("git", ["show", `${baselineRef}:src/city/materials.ts`], { cwd: root, encoding: "utf8" });
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const baseline = compareSpecialization ? "working-tree" : execFileSync("git", ["rev-parse", baselineRef], { cwd: root, encoding: "utf8" }).trim();
const dependencySources = new Map();

function loadTypeScript(entry, replacement) {
  const modules = new Map();
  const load = filename => {
    if (modules.has(filename)) return modules.get(filename).exports;
    const source = filename === materialsPath ? replacement : readFileSync(filename, "utf8");
    if (filename !== materialsPath) dependencySources.set(filename.slice(root.length + 1), digest(source));
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const loadedModule = { exports: {} };
    modules.set(filename, loadedModule);
    const requireLocal = request => {
      assert.ok(request.startsWith("."), `Unexpected dependency: ${request}`);
      const target = resolve(dirname(filename), request);
      return load(target.endsWith(".ts") ? target : `${target}.ts`);
    };
    new Function("require", "module", "exports", output)(requireLocal, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  };
  return load(entry);
}

function constantStrings(filename) {
  const source = readFileSync(filename, "utf8");
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const declarations = new Map();
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.set(node.name.text, node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  const evaluate = node => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node)) return node.text;
    if (ts.isIdentifier(node) && declarations.has(node.text)) return evaluate(declarations.get(node.text));
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return evaluate(node.left) + evaluate(node.right);
    if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map(span => evaluate(span.expression) + span.literal.text).join("");
    throw Error(`Not a static shader constant: ${node.getText(ast).slice(0, 100)}`);
  };
  return { declarations, evaluate, ast };
}

const nativePath = resolve(root, "node_modules/textmode.js/dist/textmode.esm.js");
const native = constantStrings(nativePath);
const nativeCandidates = [...native.declarations.values()].filter(node => {
  const source = node.getText(native.ast);
  return source.startsWith('"#version 300 es') && source.includes("in vec4 a_position;") && source.includes("out vec3 v_worldPosition;");
});
assert.equal(nativeCandidates.length, 1, "Installed textmode material vertex must be uniquely identifiable");
const nativeVertex = native.evaluate(nativeCandidates[0]);
const building = constantStrings(resolve(root, "src/city/building-batch.ts"));
const buildingVertex = building.evaluate(building.declarations.get("BUILDING_VERTEX"));
const prop = constantStrings(resolve(root, "src/city/prop-batch.ts"));
const mesh = constantStrings(resolve(root, "src/city/prop-canvas.ts"));
for (const [name, expression] of mesh.declarations) if (name.startsWith("MESH_")) prop.declarations.set(name, expression);
const propVertex = prop.evaluate(prop.declarations.get("PROP_VERTEX"));

function replaceExactly(source, search, replacement) {
  assert.equal(source.split(search).length, 2, `Expected one occurrence: ${search.slice(0, 80)}`);
  return source.replace(search, replacement);
}

function oldWindows(source) {
  const start = "    } else if (windowMask > 0.5 && detail > 0.5) {";
  const end = "    } else if (detail <= 0.5 && lights >";
  const currentStart = source.indexOf(start), currentEnd = source.indexOf(end, currentStart);
  const headStart = headSource.indexOf(start), headEnd = headSource.indexOf(end, headStart);
  assert.ok(currentStart >= 0 && currentEnd > currentStart && headStart >= 0 && headEnd > headStart);
  return source.slice(0, currentStart) + headSource.slice(headStart, headEnd) + source.slice(currentEnd);
}

const sourceVersions = {
  baseline: { source: headSource, description: compareSpecialization ? "Current materials.ts with all surface families enabled" : `${baselineRef} materials.ts with the same current dependency files` },
  current: { source: currentSource, description: compareSpecialization ? "Current materials.ts with production shader specialization" : "Current materials.ts, unchanged" },
  "baseline-windows": { source: oldWindows(currentSource), description: `Current material with ${baselineRef} near-window branch; removes both newer room details and glass, not a glass-only baseline` },
  "no-park": { source: replaceExactly(currentSource, currentSource.includes("${parkGlsl()}") ? "${parkGlsl()}" : '${includesGround ? parkGlsl() : ""}', "bool parkGround(vec3 p, vec3 view, float cellWorld, inout int code, inout bool thin, inout vec3 paper, inout vec3 ink, inout vec3 emission, inout float flags, inout vec3 reflectedGlyph) { return false; }"), description: "Diagnostic ablation: current shader with parkGround returning false" },
};
const versions = (args.get("versions") ?? "baseline,current").split(",");
const variants = (args.get("variants") ?? "main,reflection,batched,opaque").split(",");
const qualities = (args.get("qualities") ?? "full,lite").split(",");
const repeat = Number(args.get("repeat") ?? 2);
assert.ok(Number.isInteger(repeat) && repeat >= 1 && repeat <= 5);
if (compare) assert.ok(versions.indexOf("baseline") >= 0 && versions.indexOf("current") > versions.indexOf("baseline"), "Comparison requires baseline before current in --versions");
const options = {
  main: { reflections: true }, reflection: {}, batched: { batch: true }, opaque: { batch: true, opaque: true }, architecture: { batch: true, opaque: true },
};
const factories = new Map();
for (const version of versions) {
  assert.ok(Object.hasOwn(sourceVersions, version), `Unknown version: ${version}`);
  factories.set(version, loadTypeScript(materialsPath, sourceVersions[version].source).cityMaterial);
}

function architectureOnly(source) {
  for (const branch of ["SURFACE > 7.5", "SURFACE > 6.5", "SURFACE > 4.5", "SURFACE > 3.5", "SURFACE < 1.5"]) {
    source = replaceExactly(source, `if (${branch}) {`, "if (false) {");
  }
  return replaceExactly(source, "if (SURFACE < 2.5) {", "if (true) {");
}

const cases = [];
for (let round = 0; round < repeat; round++) for (const quality of qualities) for (const variant of variants) for (const version of versions) {
  assert.ok(Object.hasOwn(options, variant), `Unknown variant: ${variant}`);
  assert.ok(quality === "full" || quality === "lite", `Unknown quality: ${quality}`);
  const specialized = compareSpecialization ? version === "current" : args.has("specialized");
  const specialization = specialized ? variant === "opaque" ? { architecture: true } : variant === "reflection" || variant === "batched" ? { ground: false } : {} : {};
  let fragment = factories.get(version)({ ...options[variant], ...specialization, lite: quality === "lite" });
  if (variant === "architecture") fragment = architectureOnly(fragment);
  const vertex = variant === "batched" ? propVertex : options[variant].batch ? buildingVertex : nativeVertex;
  cases.push({ id: `${round + 1}-${version}-${quality}-${variant}`, round: round + 1, version, quality, variant, compare, vertex, fragment, vertexSha256: digest(vertex), fragmentSha256: digest(fragment), fragmentBytes: Buffer.byteLength(fragment) });
}

const metadata = {
  generated: new Date().toISOString(), head, baseline, specialized: args.has("specialized") || compareSpecialization, compare, compareSpecialization, textmode: JSON.parse(readFileSync(resolve(root, "node_modules/textmode.js/package.json"), "utf8")).version,
  method: "Raw WebGL2 with installed textmode material vertex or production batch vertex. Synchronous compile status, link status and uniform discovery match installed textmode. --compare adds deterministic MRT fixtures and first-draw timing; this does not measure game boot or FPS.",
  cache: "Fresh isolated Chromium profile per run; OS/driver caches are not cleared. Subsequent rounds reuse the same WebGL context.",
  descriptions: Object.fromEntries(versions.map(version => [version, sourceVersions[version].description])),
  architecture: "The optional architecture variant is a manual 0/2/6 ablation. --specialized supplies production architecture/ground flags. --compare-specialization keeps the same material source and enables those flags only for current, leaving baseline unspecialized.",
  materialSha256: Object.fromEntries(versions.map(version => [version, digest(sourceVersions[version].source)])),
  dependencies: Object.fromEntries(dependencySources),
};
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, "manifest.json"), JSON.stringify({ ...metadata, cases: cases.map(shaderCase => Object.fromEntries(Object.entries(shaderCase).filter(([name]) => name !== "vertex" && name !== "fragment"))) }, null, 2));
await writeFile(resolve(directory, "sources.json"), JSON.stringify(cases));
console.log(`Prepared ${cases.length} shader cases: ${directory}`);
if (!args.has("run")) {
  console.log("Preparation only. Add --run when the GPU test slot is available.");
  process.exit(0);
}

async function browserHarness() {
  const send = async data => {
    const response = await fetch("/event", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    if (!response.ok) throw Error("Unable to report shader progress");
  };
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    document.body.append(canvas);
    const gl = canvas.getContext("webgl2", { antialias: false, powerPreference: "high-performance" });
    if (!gl) throw Error("WebGL2 unavailable");
    const rendererInfo = gl.getExtension("WEBGL_debug_renderer_info");
    await send({ event: "renderer", renderer: rendererInfo ? gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), version: gl.getParameter(gl.VERSION), parallelCompileAvailable: !!gl.getExtension("KHR_parallel_shader_compile") });
    const shaderCases = await fetch("/sources.json").then(response => response.json());
    const measure = action => {
      const started = performance.now(), value = action();
      return { ms: performance.now() - started, value };
    };
    const referenceImages = new Map();
    const renderSamples = (program, shaderCase) => {
      const size = 96, framebuffer = gl.createFramebuffer(), textures = [], buffers = [], vao = gl.createVertexArray();
      const images = new Map();
      const started = performance.now();
      let firstDrawMs = 0;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.bindVertexArray(vao);
      gl.useProgram(program);
      gl.viewport(0, 0, size, size);
      gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      const texture = (width, height, values, floating = false) => {
        const result = gl.createTexture();
        textures.push(result); gl.bindTexture(gl.TEXTURE_2D, result);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, floating ? gl.RGBA32F : gl.RGBA8, width, height, 0, gl.RGBA, floating ? gl.FLOAT : gl.UNSIGNED_BYTE, values);
        return result;
      };
      for (let attachment = 0; attachment < 3; attachment++) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + attachment, gl.TEXTURE_2D, texture(size, size, null), 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error("Comparison framebuffer incomplete");
      const uniform = (name, values) => {
        const location = gl.getUniformLocation(program, name);
        if (!location) return;
        if (typeof values === "number") gl.uniform1f(location, values);
        else if (values.length === 16) gl.uniformMatrix4fv(location, false, values);
        else if (values.length === 4) gl.uniform4fv(location, values);
        else if (values.length === 3) gl.uniform3fv(location, values);
        else if (values.length === 2) gl.uniform2fv(location, values);
      };
      const attribute = (name, values, varying = false) => {
        const location = gl.getAttribLocation(program, name);
        if (location < 0) return;
        if (varying) {
          const buffer = gl.createBuffer(); buffers.push(buffer);
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
          gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
        } else {
          gl.disableVertexAttribArray(location);
          gl.vertexAttrib4fv(location, new Float32Array([...values, 0, 0, 0, 1].slice(0, 4)));
        }
      };
      const batch = shaderCase.variant === "opaque" || shaderCase.variant === "architecture" || shaderCase.variant === "batched";
      const prop = shaderCase.variant === "batched";
      attribute(batch ? "a_vertex" : "a_position", [-0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5], true);
      if (batch) {
        attribute(prop ? "a_origin" : "a_center", [0, -14, 0]);
        attribute("a_dimensions", [24, 24, 1]);
        attribute("a_axisX", [24, 0, 0]); attribute("a_axisY", [0, 24, 0]); attribute("a_axisZ", [0, 0, 1]);
        attribute("a_glyph", [0.18, 0, 0.25, 2]);
      } else {
        attribute("A9", [24, 24]); attribute("Aa", [0, -14, 0]); attribute("A1", [1, 0, 5]);
        attribute("A6", [0.18, 0, 0]); attribute("A5", [0, 1, 0, 0.25]);
        uniform("u_view", [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
        uniform("u_proj", [1 / 14, 0, 0, 0, 0, 1 / 14, 0, 0, 0, 0, -1 / 100, 0, 0, 1, 0, 1]);
      }
      uniform("u_time", 4); uniform("u_atmosphere", 1); uniform("u_viewRadius", 700); uniform("u_fadeIn", 1);
      uniform("u_textLength", 4); uniform("u_text0", 266305); uniform("u_holoSeed", 0.3); uniform("u_holoTint", [0.2, 0.75, 0.9]);
      uniform("u_focal", 1.6); uniform("u_aspect", 1); uniform("u_down", [0, 1, 0]);
      const scene = new Float32Array(16 * 16 * 4);
      for (let index = 0; index < 8; index++) {
        scene.set([(index - 3.5) * 6, -9, 7, 42], index * 4);
        scene.set([0.25, 0.32, 0.38, 1], (index + 8) * 4);
      }
      for (let index = 0; index < 10; index++) scene.set([1000, 1000, 1, 1], (index + 16) * 4);
      for (let index = 48; index < 238; index++) scene.set([(index - 48) / 255, 0, 0, 1], index * 4);
      const textData = new Uint8Array(64 * 64 * 4).fill(255);
      for (let row = 0; row < 64; row++) for (let column = 0; column < 64; column++) textData[(row * 64 + column) * 4] = column === 0 ? 8 : 65 + column % 26;
      gl.activeTexture(gl.TEXTURE1); texture(64, 64, textData);
      gl.uniform1i(gl.getUniformLocation(program, "u_text"), 1);
      gl.activeTexture(gl.TEXTURE0); const sceneTexture = texture(16, 16, scene, true);
      gl.uniform1i(gl.getUniformLocation(program, "u_scene"), 0);
      const samples = [];
      if (prop) samples.push({ name: "prop", surface: 2, style: 0 });
      else {
        for (let style = 0; style < 8; style++) samples.push({ name: `facade-${style}`, surface: 0, style });
        for (const surface of batch ? [2, 6] : shaderCase.variant === "main" ? [1, 2, 3, 4, 5, 7, 8] : [2, 3, 4, 5, 7, 8]) samples.push({ name: `surface-${surface}`, surface, style: 0 });
      }
      for (const sample of samples) for (const across of [0, 20]) for (const rain of [0, 1]) {
        const sampleName = `${sample.name}-angle${across}-rain${rain}`;
        const forwardLength = Math.hypot(across, 24);
        scene.set([across, -14, 24, 1], 36 * 4);
        gl.bindTexture(gl.TEXTURE_2D, sceneTexture); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 16, 16, gl.RGBA, gl.FLOAT, scene);
        uniform("u_camera", [across, -14, 24]); uniform("u_right", [24 / forwardLength, 0, -across / forwardLength]); uniform("u_forward", [-across / forwardLength, 0, -24 / forwardLength]);
        uniform("u_rain", rain); uniform("u_surface", sample.surface);
        const paper = [0.3, 0.25, 0.2, sample.surface === 0 ? (32 + sample.style * 28) / 255 : sample.surface === 8 ? 10 / 255 : 1];
        attribute(batch ? "a_ink" : "A4", [0.42, 0.54, 0.62, 0]); attribute(batch ? "a_paper" : "A0", paper);
        attribute("a_surfaceRange", [sample.surface, 1e6]); attribute("a_params", [0, 0, sample.surface, 0]);
        for (let attachment = 0; attachment < 3; attachment++) gl.clearBufferfv(gl.COLOR, attachment, new Float32Array(4));
        const drawStarted = performance.now();
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        const pixels = new Uint8Array(size * size * 4 * 3);
        for (let attachment = 0; attachment < 3; attachment++) {
          gl.readBuffer(gl.COLOR_ATTACHMENT0 + attachment);
          gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels.subarray(attachment * size * size * 4, (attachment + 1) * size * size * 4));
        }
        if (!images.size) firstDrawMs = performance.now() - drawStarted;
        if (!pixels.some(value => value !== 0)) throw Error(`Empty comparison image: ${sampleName}`);
        images.set(sampleName, pixels);
      }
      const glError = gl.getError();
      if (glError !== gl.NO_ERROR) throw Error(`Comparison WebGL error ${glError}`);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindVertexArray(null); gl.useProgram(null);
      for (const buffer of buffers) gl.deleteBuffer(buffer);
      for (const handle of textures) gl.deleteTexture(handle);
      gl.deleteVertexArray(vao); gl.deleteFramebuffer(framebuffer);
      return { images, renderMs: performance.now() - started, firstDrawMs };
    };
    for (const shaderCase of shaderCases) {
      const times = {}, shaders = [];
      let program;
      try {
        for (const [stage, kind, source] of [["vertex", gl.VERTEX_SHADER, shaderCase.vertex], ["fragment", gl.FRAGMENT_SHADER, shaderCase.fragment]]) {
          await send({ event: "stage", id: shaderCase.id, stage });
          const shader = gl.createShader(kind);
          if (!shader) throw Error(`Unable to create ${stage} shader`);
          shaders.push(shader);
          gl.shaderSource(shader, source);
          times[`${stage}Submit`] = measure(() => gl.compileShader(shader)).ms;
          const status = measure(() => gl.getShaderParameter(shader, gl.COMPILE_STATUS));
          times[`${stage}Status`] = status.ms;
          if (!status.value) throw Error(`${stage}: ${gl.getShaderInfoLog(shader)}`);
        }
        await send({ event: "stage", id: shaderCase.id, stage: "link" });
        program = gl.createProgram();
        if (!program) throw Error("Unable to create shader program");
        for (const shader of shaders) gl.attachShader(program, shader);
        times.linkSubmit = measure(() => gl.linkProgram(program)).ms;
        const linked = measure(() => gl.getProgramParameter(program, gl.LINK_STATUS));
        times.linkStatus = linked.ms;
        if (!linked.value) throw Error(`link: ${gl.getProgramInfoLog(program)}`);
        await send({ event: "stage", id: shaderCase.id, stage: "uniforms" });
        let uniformCount;
        times.uniforms = measure(() => {
          uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
          for (let index = 0; index < uniformCount; index++) {
            const uniform = gl.getActiveUniform(program, index);
            if (uniform) gl.getUniformLocation(program, uniform.name.replace(/\[0\]$/, ""));
          }
          gl.useProgram(program);
          gl.finish();
          gl.useProgram(null);
        }).ms;
        const error = gl.getError();
        if (error !== gl.NO_ERROR) throw Error(`WebGL error ${error}`);
        await send({ event: "result", id: shaderCase.id, times, totalMs: Object.values(times).reduce((total, value) => total + value, 0), uniformCount });
        if (shaderCase.compare && shaderCase.round === 1) {
          await send({ event: "stage", id: shaderCase.id, stage: "render-comparison" });
          const rendered = renderSamples(program, shaderCase), key = `${shaderCase.quality}-${shaderCase.variant}`;
          if (shaderCase.version === "baseline") {
            referenceImages.set(key, rendered.images);
            await send({ event: "reference", id: shaderCase.id, samples: rendered.images.size, renderMs: rendered.renderMs, firstDrawMs: rendered.firstDrawMs });
          } else if (shaderCase.version === "current") {
            const reference = referenceImages.get(key);
            if (!reference) throw Error(`No baseline images for ${key}`);
            let changedBytes = 0, maxDelta = 0;
            const changedSamples = [];
            for (const [name, pixels] of rendered.images) {
              const original = reference.get(name);
              if (!original || original.length !== pixels.length) throw Error(`Missing reference image ${name}`);
              let changed = 0;
              for (let index = 0; index < pixels.length; index++) if (pixels[index] !== original[index]) { changed++; maxDelta = Math.max(maxDelta, Math.abs(pixels[index] - original[index])); }
              if (changed) changedSamples.push({ name, bytes: changed });
              changedBytes += changed;
            }
            referenceImages.delete(key);
            await send({ event: "comparison", id: shaderCase.id, samples: rendered.images.size, changedBytes, maxDelta, changedSamples, renderMs: rendered.renderMs, firstDrawMs: rendered.firstDrawMs });
          }
        }
      } catch (error) {
        await send({ event: "failure", id: shaderCase.id, error: String(error), times });
      } finally {
        for (const shader of shaders) gl.deleteShader(shader);
        if (program) gl.deleteProgram(program);
      }
    }
    await send({ event: "done" });
  } catch (error) {
    await send({ event: "fatal", error: String(error) });
  }
}

const report = { ...metadata, events: [] };
let done = false, lastProgress = Date.now(), failure, chrome;
const writeReport = () => writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
let writePending = Promise.resolve();
const server = createServer(async (request, response) => {
  if (request.url === "/event" && request.method === "POST") {
    const buffers = [];
    for await (const buffer of request) buffers.push(buffer);
    const event = JSON.parse(Buffer.concat(buffers).toString("utf8"));
    report.events.push({ ...event, received: new Date().toISOString() });
    lastProgress = Date.now();
    if (event.event === "done" || event.event === "fatal") done = true;
    if (event.event === "failure" || event.event === "fatal") failure = event.error;
    if (event.event === "comparison" && event.changedBytes > 0) failure = `MRT comparison differs in ${event.id}: ${event.changedBytes} bytes`;
    console.log(JSON.stringify(event));
    writePending = writePending.then(writeReport);
    await writePending;
    response.writeHead(200).end("ok");
  } else if (request.url === "/sources.json") {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(cases));
  } else if (request.url === "/") {
    response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><meta charset="utf-8"><title>Shader startup diagnostic</title><body><script>(${browserHarness.toString()})()</script>`);
  } else response.writeHead(404).end();
});

try {
  await new Promise((ready, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", ready); });
  const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
  let executable;
  for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
  if (!executable) throw Error("Set CHROME_PATH to an installed Chromium browser");
  const profile = await mkdtemp(resolve(directory, "profile-"));
  const url = `http://127.0.0.1:${server.address().port}`;
  chrome = spawn(executable, ["--headless=new", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", "--enable-webgl", ...(args.has("software") ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : []), url], { windowsHide: true, stdio: "ignore" });
  chrome.on("error", error => { failure = String(error); done = true; });
  chrome.on("exit", code => { if (!done) { failure = `Browser exited ${code}`; done = true; } });
  const started = Date.now(), stageTimeout = Number(args.get("stage-timeout") ?? 180000), timeout = Number(args.get("timeout") ?? 900000);
  while (!done) {
    await delay(250);
    if (Date.now() - lastProgress > stageTimeout || Date.now() - started > timeout) {
      failure = "Shader startup diagnostic timed out; inspect the last reported stage. This is not an FPS measurement.";
      report.events.push({ event: "timeout", error: failure, received: new Date().toISOString() });
      break;
    }
  }
  await writePending;
  await writeReport();
  if (failure) throw Error(failure);
  console.log(`Shader startup report: ${resolve(directory, "report.json")}`);
} finally {
  chrome?.kill();
  server.closeAllConnections();
  await new Promise(ready => server.close(ready));
}
