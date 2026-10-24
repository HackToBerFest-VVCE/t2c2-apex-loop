import { useEffect, useRef, useState } from 'react';
import { analyzeIssue } from '../lib/gemini.js';
import { prepareImage } from '../lib/image.js';
import { locate } from '../lib/location.js';
import { DEPARTMENTS, SEVERITY_LABEL } from '../lib/constants.js';
import { authorityFor } from '../lib/authorities.js';
import { savePhoto } from '../lib/photos.js';
import { SeverityBadge } from '../components/Badges.jsx';
import CameraCapture from '../components/CameraCapture.jsx';
import {
  AlertIcon,
  ArrowRightIcon,
  CameraIcon,
  CheckIcon,
  DocIcon,
  PinIcon,
  SparkIcon,
  UploadIcon,
  XIcon,
} from '../components/Icons.jsx';

const STAGES = ['locate', 'analyze', 'draft'];
const STAGE_TITLES = {
  locate: 'Pinning the location',
  analyze: 'Analysing the photo',
  draft: 'Drafting your complaint',
};
/** How long a finished stage's result stays on screen before the next stage, so it can be read. */
const RESULT_DWELL_MS = 1100;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** One-line summary of a location result, and whether it is a full success. */
function describePlace(p) {
  if (!p) return { ok: false, text: 'No location found. The letter will have a blank to fill in.' };
  if (p.error) return { ok: false, text: `${p.error} The letter will have a blank to fill in.` };
  if (p.approximate) return { ok: false, text: `Approximate area only: ${p.address || 'unknown'}` };
  const how = p.source === 'photo' ? 'from the photo' : `±${Math.round(p.accuracy)} m`;
  if (p.staleFallback) {
    return {
      ok: false,
      text: `This photo has no saved location, so we used where you are now${p.address ? ` (${p.address})` : ''}. If you took it somewhere else, fix the address in the letter.`,
    };
  }
  if (!p.address) return { ok: false, text: `Pinned at ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)} (${how}); street name unavailable` };
  return { ok: true, text: `${p.address} · ${how}` };
}

export default function ReportScreen({ onCreate }) {
  const fileRef = useRef(null);
  const [image, setImage] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | ready | working | done
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  // The single stage on screen while working: { id, detail, outcome: null | 'ok' | 'warn', startedAt }
  const [stage, setStage] = useState(null);
  const stageRef = useRef(null);
  const fileObj = useRef(null);
  const placeRef = useRef(null); // promise of the current location lookup
  const placeResult = useRef(null);
  const runToken = useRef(null); // identifies the latest location lookup so stale ones are ignored
  const locateOpts = useRef({ fromCamera: false }); // how the current photo was taken (for retries)
  const [dragging, setDragging] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  function showStage(next) {
    stageRef.current = next;
    setStage(next);
  }

  /** Live progress lines only update the screen when their stage is the one showing. */
  function progressFor(id) {
    return (detail) => {
      if (stageRef.current?.id === id && !stageRef.current.outcome) showStage({ ...stageRef.current, detail });
    };
  }

  function startLocating(file, opts = locateOpts.current) {
    locateOpts.current = opts;
    placeResult.current = null;
    // Token is set before locate() starts so its very first progress message isn't dropped.
    const token = {};
    runToken.current = token;
    const onProgress = progressFor('locate');
    const run = locate(file, (detail) => runToken.current === token && onProgress(detail), opts);
    placeRef.current = run.then((p) => {
      if (runToken.current === token) placeResult.current = p;
      return p;
    });
  }

  /** fromCamera: taken just now with the in-app camera, so the phone's current GPS is the right spot. */
  async function handleFile(file, { fromCamera = false } = {}) {
    if (!file) return;
    setError('');
    setResult(null);
    fileObj.current = file;
    // Location runs quietly in the background from the moment a photo is chosen.
    startLocating(file, { fromCamera });
    try {
      setImage(await prepareImage(file));
      setPhase('ready');
    } catch (e) {
      setError(e.message);
    }
  }

  function reset() {
    setImage(null);
    setResult(null);
    setError('');
    showStage(null);
    placeRef.current = null;
    placeResult.current = null;
    runToken.current = null;
    setPhase('idle');
  }

  async function createReport(analysis) {
    const where = placeResult.current;
    const exact = where && !where.error && !where.approximate;
    const id = crypto.randomUUID();
    // Full-size photo for the email attachment; saved before the complaint screen opens and reads it.
    await savePhoto(id, image.preview);
    onCreate({
      id,
      createdAt: new Date().toISOString(),
      thumb: image.thumb,
      status: 'Drafted',
      location: where?.address || '',
      area: where?.area ?? null,
      coords: exact ? { lat: where.lat, lon: where.lon, accuracy: where.accuracy, source: where.source } : null,
      name: '', // filled from the signed-in account once login exists
      ...analysis,
    });
    reset();
  }

  async function run() {
    setPhase('working');
    setError('');

    // A failed lookup may succeed now (e.g. location permission was just granted), so try again.
    const prior = placeResult.current;
    if (prior && (prior.error || prior.approximate)) startLocating(fileObj.current);

    // The photo goes to the AI immediately and works in parallel; the screen walks through stages in order.
    const analyzeProgress = progressFor('analyze');
    let latestAnalyzeDetail = 'Sending the photo';
    const analysis = analyzeIssue(image.base64, image.mimeType, (d) => {
      latestAnalyzeDetail = d;
      analyzeProgress(d);
    });
    analysis.catch(() => {}); // handled when awaited below

    // 1. Location
    showStage({ id: 'locate', detail: 'Getting a GPS fix', outcome: null, startedAt: Date.now() });
    const place = describePlace(await placeRef.current);
    showStage({ ...stageRef.current, detail: place.text, outcome: place.ok ? 'ok' : 'warn' });
    await wait(RESULT_DWELL_MS);

    // 2. Photo analysis
    showStage({ id: 'analyze', detail: latestAnalyzeDetail, outcome: null, startedAt: Date.now() });
    let found;
    try {
      found = await analysis;
    } catch (e) {
      showStage(null);
      setError(e?.message || 'Something went wrong while analysing the photo.');
      setPhase('ready');
      return;
    }
    showStage({
      ...stageRef.current,
      detail: `${found.issueType} · ${SEVERITY_LABEL[found.severity]} severity`,
      outcome: found.isCivicIssue ? 'ok' : 'warn',
    });
    await wait(RESULT_DWELL_MS);

    if (!found.isCivicIssue) {
      showStage(null);
      setResult(found);
      setPhase('done');
      return;
    }

    // 3. Letters (generated instantly from templates; shown briefly so the hand-off isn't abrupt)
    const to = authorityFor({ ...found, area: placeResult.current?.area });
    showStage({ id: 'draft', detail: `English and ಕನ್ನಡ letters to ${to.short}`, outcome: null, startedAt: Date.now() });
    await wait(700);
    showStage({ ...stageRef.current, detail: 'Ready to review', outcome: 'ok' });
    await wait(600);
    createReport(found);
  }

  const pickers = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        handleFile(e.target.files[0]);
        e.target.value = ''; // let the same file be picked again
      }}
    />
  );

  return (
    <div className="screen">
      <header className="screen-head">
        <p className="eyebrow">New report</p>
        <h1>Spot a problem? Snap it.</h1>
        <p className="lede">
          Photograph a pothole, broken streetlight, garbage pile or leak. We’ll identify it, pin the exact location
          and draft a complaint to the right civic body for you.
        </p>
      </header>

      {pickers}

      {cameraOpen && (
        <CameraCapture
          onCapture={(file) => {
            setCameraOpen(false);
            handleFile(file, { fromCamera: true });
          }}
          onCancel={() => setCameraOpen(false)}
          onUnavailable={(reason) => {
            setCameraOpen(false);
            setError(reason);
          }}
        />
      )}

      {!image ? (
        <div
          className={`dropzone ${dragging ? 'is-dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFile(e.dataTransfer.files[0]);
          }}
        >
          <div className="dropzone-icon">
            <CameraIcon width={28} height={28} />
          </div>
          <p className="dropzone-title">Add a photo of the issue</p>
          <p className="dropzone-sub">Clear, well-lit photos give the best results</p>
          <div className="dropzone-actions">
            <button className="btn btn-primary btn-lg" onClick={() => setCameraOpen(true)}>
              <CameraIcon /> Take photo
            </button>
            <button className="btn btn-secondary btn-lg" onClick={() => fileRef.current.click()}>
              <UploadIcon /> Upload
            </button>
          </div>
        </div>
      ) : (
        <div className="card photo-card">
          <div className={`photo-wrap ${stage ? 'is-working' : ''} ${stage?.id === 'analyze' ? 'is-scanning' : ''}`}>
            <img src={image.preview} alt="Selected civic issue" />
            {phase !== 'working' && (
              <button className="icon-btn photo-clear" onClick={reset} aria-label="Remove photo">
                <XIcon width={18} height={18} />
              </button>
            )}
            {stage?.id === 'analyze' && !stage.outcome && <div className="scanline" />}
            {stage && <StageOverlay stage={stage} />}
          </div>

          {phase !== 'done' && phase !== 'working' && (
            <div className="photo-footer">
              <button className="btn btn-primary btn-lg btn-block" onClick={run}>
                <SparkIcon /> {error ? 'Try again' : 'Analyze'}
              </button>
              <button className="btn btn-ghost btn-block" onClick={() => fileRef.current.click()}>
                Choose a different photo
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="alert" role="alert">
          <AlertIcon width={18} height={18} />
          <span>{error}</span>
        </div>
      )}

      {phase === 'done' && result && (
        <div className="card result-card fade-in">
          <div className="alert alert-soft">
            <AlertIcon width={18} height={18} />
            <span>This photo may not show a civic issue. You can retake it or continue anyway.</span>
          </div>

          <div className="result-head">
            <div>
              <p className="eyebrow">AI assessment</p>
              <h2>{result.issueType}</h2>
            </div>
            <SeverityBadge severity={result.severity} />
          </div>

          <p className="result-desc">{result.description}</p>

          <dl className="facts">
            <div>
              <dt>Department</dt>
              <dd>{DEPARTMENTS[result.department].label}</dd>
            </div>
            <div>
              <dt>Authority</dt>
              <dd>{authorityFor({ ...result, area: placeResult.current?.area }).short}</dd>
            </div>
          </dl>

          <button className="btn btn-primary btn-lg btn-block" onClick={() => createReport(result)}>
            Draft complaint anyway <ArrowRightIcon />
          </button>
        </div>
      )}
    </div>
  );
}

const STAGE_ICONS = { locate: PinIcon, analyze: SparkIcon, draft: DocIcon };

/** Shows only the current stage over the photo: animated emblem, title, live detail and progress. */
function StageOverlay({ stage }) {
  const index = STAGES.indexOf(stage.id);
  const Icon = STAGE_ICONS[stage.id];
  const [, tick] = useState(0);
  useEffect(() => {
    if (stage.outcome) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [stage.outcome]);
  const seconds = Math.floor((Date.now() - stage.startedAt) / 1000);

  return (
    <div className="stage-overlay" role="status" aria-live="polite">
      <div key={stage.id} className={`stage-emblem stage-${stage.id} ${stage.outcome ? `is-${stage.outcome}` : ''}`}>
        {!stage.outcome && <span className="stage-ring" />}
        {!stage.outcome && <span className="stage-ring stage-ring-2" />}
        <span className="stage-core">
          {stage.outcome === 'ok' ? (
            <CheckIcon width={26} height={26} />
          ) : stage.outcome === 'warn' ? (
            <AlertIcon width={24} height={24} />
          ) : (
            <Icon width={24} height={24} />
          )}
        </span>
      </div>

      <div key={`${stage.id}-text`} className="stage-text">
        <p className="stage-step">
          Step {index + 1} of {STAGES.length}
          {!stage.outcome && seconds >= 3 && <span> · {seconds}s</span>}
        </p>
        <p className="stage-title">{STAGE_TITLES[stage.id]}</p>
        <p key={stage.detail} className="stage-detail">
          {stage.detail}
        </p>
      </div>

      <div className="stage-progress" aria-hidden>
        {STAGES.map((id, i) => (
          <span
            key={id}
            className={`stage-seg ${i < index || (i === index && stage.outcome) ? 'is-done' : ''} ${
              i === index && !stage.outcome ? 'is-active' : ''
            }`}
          />
        ))}
      </div>
    </div>
  );
}
