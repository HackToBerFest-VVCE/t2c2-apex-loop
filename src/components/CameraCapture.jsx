import { useEffect, useRef, useState } from 'react';
import { CameraIcon, XIcon } from './Icons.jsx';

/**
 * Full-screen live camera using getUserMedia, so "Take photo" opens the camera on laptops too
 * (the file input's `capture` attribute only works on phones). Calls onCapture(File) or onCancel().
 * If the camera can't be opened, calls onUnavailable(reason) so the caller can fall back to a file picker.
 */
export default function CameraCapture({ onCapture, onCancel, onUnavailable }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [facing, setFacing] = useState('environment'); // back camera on phones
  const [canSwitch, setCanSwitch] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      setReady(false);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
        setReady(true);
        const devices = await navigator.mediaDevices.enumerateDevices();
        setCanSwitch(devices.filter((d) => d.kind === 'videoinput').length > 1);
      } catch (e) {
        if (!cancelled) {
          onUnavailable(
            e?.name === 'NotAllowedError'
              ? 'Camera permission is blocked. Allow the camera for this site, or upload a photo instead.'
              : 'No camera could be opened on this device. Choose a photo instead.'
          );
        }
      }
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      onUnavailable('This browser cannot open the camera. Choose a photo instead.');
      return undefined;
    }
    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close with Escape on desktop.
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  function snap() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        onCapture(new File([blob], `civiclens-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92
    );
  }

  return (
    <div className="camera" role="dialog" aria-modal="true" aria-label="Camera">
      <video ref={videoRef} className={`camera-video ${facing === 'user' ? 'is-mirrored' : ''}`} playsInline muted />
      {!ready && (
        <div className="camera-status">
          <span className="spinner" /> Opening camera…
        </div>
      )}
      <button className="camera-close" onClick={onCancel} aria-label="Close camera">
        <XIcon width={22} height={22} />
      </button>
      <div className="camera-bar">
        <span className="camera-side" />
        <button className="camera-shutter" onClick={snap} disabled={!ready} aria-label="Take photo">
          <CameraIcon width={26} height={26} />
        </button>
        <span className="camera-side">
          {canSwitch && (
            <button
              className="camera-switch"
              onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
            >
              Switch
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
