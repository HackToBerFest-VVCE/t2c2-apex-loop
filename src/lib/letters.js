import { DEPARTMENTS, SEVERITY_KN, SEVERITY_LABEL } from './constants.js';
import { mapsLink } from './location.js';
import { addresseeKn, authorityFor } from './authorities.js';

function formatDate(iso, locale) {
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

const URGENCY_EN = {
  high: 'Given that this poses an immediate risk to public safety, I request that it be treated as urgent and attended to at the earliest.',
  medium: 'If left unattended, this problem is likely to worsen and cause further inconvenience to residents. I request that it be addressed promptly.',
  low: 'Although minor, this issue affects the upkeep of our neighbourhood, and I request that it be addressed in the course of routine maintenance.',
};

const URGENCY_KN = {
  high: 'ಇದು ಸಾರ್ವಜನಿಕರ ಸುರಕ್ಷತೆಗೆ ತಕ್ಷಣದ ಅಪಾಯವನ್ನುಂಟುಮಾಡುತ್ತಿರುವುದರಿಂದ, ಇದನ್ನು ತುರ್ತು ಎಂದು ಪರಿಗಣಿಸಿ ಆದಷ್ಟು ಬೇಗ ಕ್ರಮ ಕೈಗೊಳ್ಳಬೇಕೆಂದು ವಿನಂತಿಸುತ್ತೇನೆ.',
  medium: 'ಇದನ್ನು ಹೀಗೆಯೇ ಬಿಟ್ಟರೆ ಸಮಸ್ಯೆ ಇನ್ನಷ್ಟು ಉಲ್ಬಣಗೊಂಡು ನಿವಾಸಿಗಳಿಗೆ ಹೆಚ್ಚಿನ ತೊಂದರೆಯಾಗುವ ಸಾಧ್ಯತೆ ಇದೆ. ಆದ್ದರಿಂದ ಶೀಘ್ರವಾಗಿ ಕ್ರಮ ಕೈಗೊಳ್ಳಬೇಕೆಂದು ವಿನಂತಿಸುತ್ತೇನೆ.',
  low: 'ಇದು ಸಣ್ಣ ಸಮಸ್ಯೆಯಾದರೂ ನಮ್ಮ ಬಡಾವಣೆಯ ನಿರ್ವಹಣೆಗೆ ಸಂಬಂಧಿಸಿದ್ದು, ನಿಯಮಿತ ನಿರ್ವಹಣಾ ಕಾರ್ಯದ ಭಾಗವಾಗಿ ಇದನ್ನು ಸರಿಪಡಿಸಬೇಕೆಂದು ವಿನಂತಿಸುತ್ತೇನೆ.',
};

/** First two parts of the address, so subject lines stay short. */
function shortPlace(r) {
  return (r.location || '').split(', ').slice(0, 2).join(', ');
}

/** Address line plus exact GPS pin, so the crew can find the spot even if the address is approximate. */
function locationLines(r, gpsLabel, mapLabel) {
  const lines = [r.location].filter(Boolean);
  if (r.coords) {
    lines.push(`${gpsLabel}: ${r.coords.lat.toFixed(6)}, ${r.coords.lon.toFixed(6)}`);
    if (mapLabel) lines.push(`${mapLabel}: ${mapsLink(r.coords)}`); // Kannada letter skips it: already in the English one
  }
  return lines.join('\n');
}

export function englishSubject(r) {
  const where = shortPlace(r) ? ` at ${shortPlace(r)}` : '';
  return `Complaint regarding ${r.issueType.toLowerCase()}${where}`;
}

export function englishLetter(r) {
  const dept = DEPARTMENTS[r.department];
  const to = authorityFor(r);
  const name = r.name || 'A concerned citizen';
  const location = locationLines(r, 'GPS', 'Map') || '[Location / landmark]';
  return `To,
${to.addressee},
${to.local ? `${dept.full},
` : ''}${to.name},
${to.place}.

Date: ${formatDate(r.createdAt, 'en-IN')}

Subject: ${englishSubject(r)}

Respected Sir/Madam,

I wish to bring to your attention a civic issue in our area that requires the attention of ${to.local ? `the ${dept.full}` : to.name}.

Issue type: ${r.issueType}
Location:
${location}
Severity: ${SEVERITY_LABEL[r.severity]}

Details: ${r.description}

${URGENCY_EN[r.severity]} A photograph of the issue is available and can be shared on request.

Thank you for your time and prompt action.

Yours faithfully,
${name}`;
}

export function kannadaLetter(r) {
  const dept = DEPARTMENTS[r.department];
  const to = authorityFor(r);
  const name = r.name || 'ಒಬ್ಬ ಕಾಳಜಿಯುಳ್ಳ ನಾಗರಿಕ';
  const location = locationLines(r, 'GPS') || '[ಸ್ಥಳ / ಹೆಗ್ಗುರುತು]';
  const subject = shortPlace(r) ? `${shortPlace(r)} ಬಳಿ ${r.issueTypeKn} ಕುರಿತು ದೂರು` : `${r.issueTypeKn} ಕುರಿತು ದೂರು`;
  const details = r.descriptionKn || r.description;
  return `ಇವರಿಗೆ,
${addresseeKn(to)},
${to.local ? `${dept.kn},
` : ''}${to.kn},
${to.placeKn}.

ದಿನಾಂಕ: ${formatDate(r.createdAt, 'kn-IN')}

ವಿಷಯ: ${subject}

ಮಾನ್ಯರೇ,

ನಮ್ಮ ಪ್ರದೇಶದಲ್ಲಿರುವ ಈ ಕೆಳಗಿನ ನಾಗರಿಕ ಸಮಸ್ಯೆಯನ್ನು ತಮ್ಮ ಗಮನಕ್ಕೆ ತರಲು ಬಯಸುತ್ತೇನೆ.

ಸಮಸ್ಯೆಯ ವಿಧ: ${r.issueTypeKn}
ಸ್ಥಳ:
${location}
ತೀವ್ರತೆ: ${SEVERITY_KN[r.severity]}

ವಿವರ: ${details}

${URGENCY_KN[r.severity]} ಸಮಸ್ಯೆಯ ಛಾಯಾಚಿತ್ರ ಲಭ್ಯವಿದ್ದು, ಅಗತ್ಯವಿದ್ದಲ್ಲಿ ಒದಗಿಸಲಾಗುವುದು.

ತಮ್ಮ ಸಮಯ ಮತ್ತು ಶೀಘ್ರ ಕ್ರಮಕ್ಕಾಗಿ ಧನ್ಯವಾದಗಳು.

ತಮ್ಮ ವಿಶ್ವಾಸಿ,
${name}`;
}

export function bilingualBody(r) {
  return `${englishLetter(r)}\n\n--------------------\n\n${kannadaLetter(r)}`;
}

/**
 * One escalation email when a complaint reaches a support milestone (3, 5, 10… people), sent instead of
 * a duplicate complaint for every person who reports the same spot.
 * @param {{ issueType, severity, location, lat, lon, authority, firstReportedAt }} complaint
 */
export function escalationEmail(complaint, supporters, name) {
  const issue = complaint.issueType.toLowerCase();
  const where = complaint.location ? ` at ${complaint.location}` : '';
  const first = formatDate(complaint.firstReportedAt, 'en-IN');
  const firstKn = formatDate(complaint.firstReportedAt, 'kn-IN');
  const map = complaint.lat != null ? `\nMap: ${mapsLink({ lat: complaint.lat, lon: complaint.lon })}` : '';
  const subject = `ESCALATION: ${complaint.issueType}${where}, reported by ${supporters} citizens`;
  const body = `To,
${complaint.authority || 'The concerned authority'}.

Subject: ${subject}

Respected Sir/Madam,

The ${issue}${where} was first reported to you on ${first} and has not yet been fixed. ${supporters} citizens have now reported the same problem at this spot through CivicLens, so I am writing on their behalf to request urgent attention.

Issue type: ${complaint.issueType}
Reported by: ${supporters} citizens (first report: ${first})${map}

A recent photo of the problem is attached.

Yours faithfully,
${name || 'A concerned citizen'}

--------------------

ವಿಷಯ: ತುರ್ತು ಗಮನಕ್ಕೆ — ${supporters} ನಾಗರಿಕರು ವರದಿ ಮಾಡಿದ ಸಮಸ್ಯೆ

ಈ ಸಮಸ್ಯೆಯನ್ನು ${firstKn} ರಂದು ಮೊದಲು ವರದಿ ಮಾಡಲಾಗಿತ್ತು. ಇದುವರೆಗೂ ಸರಿಪಡಿಸಲಾಗಿಲ್ಲ. ಈಗ ${supporters} ನಾಗರಿಕರು ಇದೇ ಸ್ಥಳದ ಸಮಸ್ಯೆಯನ್ನು ವರದಿ ಮಾಡಿದ್ದಾರೆ. ದಯವಿಟ್ಟು ತುರ್ತು ಕ್ರಮ ಕೈಗೊಳ್ಳಬೇಕೆಂದು ವಿನಂತಿಸುತ್ತೇವೆ.`;
  return { subject, body };
}
