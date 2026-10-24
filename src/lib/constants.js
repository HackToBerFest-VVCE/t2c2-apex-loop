// Shared vocabulary for issue types, departments and severities (English + Kannada).

export const ISSUE_TYPES = [
  'Pothole',
  'Road damage',
  'Broken streetlight',
  'Exposed wiring',
  'Garbage pile',
  'Overflowing bin',
  'Water leak',
  'Drainage / sewage',
  'Other',
];

export const ISSUE_TYPES_KN = {
  Pothole: 'ರಸ್ತೆ ಗುಂಡಿ',
  'Road damage': 'ರಸ್ತೆ ಹಾನಿ',
  'Broken streetlight': 'ಕೆಟ್ಟುಹೋದ ಬೀದಿ ದೀಪ',
  'Exposed wiring': 'ತೆರೆದ ವಿದ್ಯುತ್ ತಂತಿ',
  'Garbage pile': 'ಕಸದ ರಾಶಿ',
  'Overflowing bin': 'ತುಂಬಿ ಹರಿಯುತ್ತಿರುವ ಕಸದ ತೊಟ್ಟಿ',
  'Water leak': 'ನೀರಿನ ಸೋರಿಕೆ',
  'Drainage / sewage': 'ಒಳಚರಂಡಿ ಸಮಸ್ಯೆ',
  Other: 'ನಾಗರಿಕ ಸಮಸ್ಯೆ',
};

export const DEPARTMENTS = {
  Roads: {
    label: 'Roads',
    full: 'Roads & Infrastructure Department',
    kn: 'ರಸ್ತೆ ಮತ್ತು ಮೂಲಸೌಕರ್ಯ ವಿಭಾಗ',
  },
  Electrical: {
    label: 'Electrical',
    full: 'Electrical Department (Streetlights)',
    kn: 'ವಿದ್ಯುತ್ ವಿಭಾಗ (ಬೀದಿ ದೀಪಗಳು)',
  },
  Waste: {
    label: 'Waste',
    full: 'Solid Waste Management Department',
    kn: 'ಘನತ್ಯಾಜ್ಯ ನಿರ್ವಹಣಾ ವಿಭಾಗ',
  },
  Water: {
    label: 'Water',
    full: 'Water Supply & Drainage Department',
    kn: 'ನೀರು ಸರಬರಾಜು ಮತ್ತು ಒಳಚರಂಡಿ ವಿಭಾಗ',
  },
};

export const SEVERITIES = ['low', 'medium', 'high'];

export const SEVERITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' };
export const SEVERITY_KN = { low: 'ಕಡಿಮೆ', medium: 'ಮಧ್ಯಮ', high: 'ಹೆಚ್ಚು (ತುರ್ತು)' };

export const STATUSES = ['Drafted', 'Sent', 'Resolved'];

// Placeholder recipient for testing — swap for each authority's real grievance address later.
export const COMPLAINT_EMAIL = 'gamingispeakk@gmail.com';
