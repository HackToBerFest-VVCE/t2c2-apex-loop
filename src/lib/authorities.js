// Works out which public body should receive a complaint, from the kind of problem and where it is.
// Karnataka only for now. Names reflect the Sept 2025 split of BBMP into the Greater Bengaluru
// Authority (GBA) and its five city corporations.

/** Electricity supply companies (ESCOMs) by district keyword. */
const ESCOMS = [
  {
    districts: ['bengaluru', 'bangalore', 'kolar', 'tumakuru', 'tumkur', 'chitradurga', 'davanagere', 'chikkaballapur', 'ramanagara'],
    name: 'Bangalore Electricity Supply Company Limited (BESCOM)',
    kn: 'ಬೆಂಗಳೂರು ವಿದ್ಯುತ್ ಸರಬರಾಜು ಕಂಪನಿ ನಿಯಮಿತ (ಬೆಸ್ಕಾಂ)',
    short: 'BESCOM',
  },
  {
    districts: ['mysuru', 'mysore', 'mandya', 'chamarajanagar', 'hassan', 'kodagu'],
    name: 'Chamundeshwari Electricity Supply Corporation Limited (CESC)',
    kn: 'ಚಾಮುಂಡೇಶ್ವರಿ ವಿದ್ಯುತ್ ಸರಬರಾಜು ನಿಗಮ ನಿಯಮಿತ (ಸೆಸ್ಕ್)',
    short: 'CESC',
  },
  {
    districts: ['dakshina kannada', 'udupi', 'shivamogga', 'shimoga', 'chikkamagaluru'],
    name: 'Mangalore Electricity Supply Company Limited (MESCOM)',
    kn: 'ಮಂಗಳೂರು ವಿದ್ಯುತ್ ಸರಬರಾಜು ಕಂಪನಿ ನಿಯಮಿತ (ಮೆಸ್ಕಾಂ)',
    short: 'MESCOM',
  },
  {
    districts: ['belagavi', 'belgaum', 'dharwad', 'haveri', 'uttara kannada', 'gadag', 'bagalkot', 'vijayapura', 'bijapur'],
    name: 'Hubli Electricity Supply Company Limited (HESCOM)',
    kn: 'ಹುಬ್ಬಳ್ಳಿ ವಿದ್ಯುತ್ ಸರಬರಾಜು ಕಂಪನಿ ನಿಯಮಿತ (ಹೆಸ್ಕಾಂ)',
    short: 'HESCOM',
  },
  {
    districts: ['kalaburagi', 'gulbarga', 'bidar', 'raichur', 'koppal', 'ballari', 'bellary', 'yadgir', 'vijayanagara'],
    name: 'Gulbarga Electricity Supply Company Limited (GESCOM)',
    kn: 'ಗುಲ್ಬರ್ಗಾ ವಿದ್ಯುತ್ ಸರಬರಾಜು ಕಂಪನಿ ನಿಯಮಿತ (ಜೆಸ್ಕಾಂ)',
    short: 'GESCOM',
  },
];

const BENGALURU_CORPORATIONS_KN = {
  Central: 'ಬೆಂಗಳೂರು ಕೇಂದ್ರ ನಗರ ಪಾಲಿಕೆ',
  North: 'ಬೆಂಗಳೂರು ಉತ್ತರ ನಗರ ಪಾಲಿಕೆ',
  South: 'ಬೆಂಗಳೂರು ದಕ್ಷಿಣ ನಗರ ಪಾಲಿಕೆ',
  East: 'ಬೆಂಗಳೂರು ಪೂರ್ವ ನಗರ ಪಾಲಿಕೆ',
  West: 'ಬೆಂಗಳೂರು ಪಶ್ಚಿಮ ನಗರ ಪಾಲಿಕೆ',
};

const GBA_KN = 'ಗ್ರೇಟರ್ ಬೆಂಗಳೂರು ಪ್ರಾಧಿಕಾರ (ಜಿಬಿಎ)';

/** Which kind of body fixes this problem: the local civic body, the water board, or the power company. */
function serviceFor(report) {
  if (report.issueType === 'Exposed wiring') return 'power';
  if (report.department === 'Water') return 'water';
  return 'civic';
}

const isBengaluru = (area) => /bengaluru|bangalore/i.test(`${area.city ?? ''} ${area.corporation ?? ''}`);

function localBody(area) {
  if (isBengaluru(area)) {
    const zone = area.corporation?.match(/Bengaluru (Central|North|South|East|West) City Corporation/)?.[1];
    if (zone) {
      return {
        addressee: 'The Commissioner',
        name: `${area.corporation}, Greater Bengaluru Authority (GBA)`,
        kn: `${BENGALURU_CORPORATIONS_KN[zone]}, ${GBA_KN}`,
        short: `${zone} City Corporation (GBA)`,
        place: 'Bengaluru',
        placeKn: 'ಬೆಂಗಳೂರು',
      };
    }
    return {
      addressee: 'The Chief Commissioner',
      name: 'Greater Bengaluru Authority (GBA)',
      kn: GBA_KN,
      short: 'GBA',
      place: 'Bengaluru',
      placeKn: 'ಬೆಂಗಳೂರು',
    };
  }
  if (/mysuru|mysore/i.test(area.city ?? '')) {
    return {
      addressee: 'The Commissioner',
      name: 'Mysuru City Corporation (MCC)',
      kn: 'ಮೈಸೂರು ಮಹಾನಗರ ಪಾಲಿಕೆ',
      short: 'Mysuru City Corporation',
      place: 'Mysuru',
      placeKn: 'ಮೈಸೂರು',
    };
  }
  if (area.city) {
    return {
      addressee: 'The Commissioner',
      name: `${area.city} City Municipal Body`,
      kn: `${area.city} ನಗರ ಸ್ಥಳೀಯ ಸಂಸ್ಥೆ`,
      short: `${area.city} municipality`,
      place: area.city,
      placeKn: area.city,
    };
  }
  // Villages and outskirts fall under the gram panchayat, which has no separate departments.
  return {
    addressee: 'The Panchayat Development Officer',
    name: area.village ? `${area.village} Gram Panchayat` : 'Gram Panchayat',
    kn: area.village ? `${area.village} ಗ್ರಾಮ ಪಂಚಾಯಿತಿ` : 'ಗ್ರಾಮ ಪಂಚಾಯಿತಿ',
    short: 'Gram Panchayat',
    place: area.district ? `${area.district} District` : 'Karnataka',
    placeKn: area.district ? `${area.district} ಜಿಲ್ಲೆ` : 'ಕರ್ನಾಟಕ',
    noDepartments: true,
  };
}

/**
 * The body a report should go to, with names in English and Kannada.
 * Reports without area details (older ones, or when location failed) default to Bengaluru's GBA.
 */
export function authorityFor(report) {
  const area = report.area ?? { city: 'Bengaluru' };
  const service = serviceFor(report);

  if (service === 'water' && isBengaluru(area)) {
    return {
      addressee: 'The Chief Engineer',
      name: 'Bangalore Water Supply and Sewerage Board (BWSSB)',
      kn: 'ಬೆಂಗಳೂರು ನೀರು ಸರಬರಾಜು ಮತ್ತು ಒಳಚರಂಡಿ ಮಂಡಳಿ (ಜಲಮಂಡಳಿ)',
      short: 'BWSSB',
      place: 'Bengaluru',
      placeKn: 'ಬೆಂಗಳೂರು',
    };
  }

  if (service === 'power') {
    const key = `${area.district ?? ''} ${area.city ?? ''}`.toLowerCase();
    const escom = ESCOMS.find((e) => e.districts.some((d) => key.includes(d))) ?? ESCOMS[0];
    const local = localBody(area);
    return {
      addressee: 'The Executive Engineer (O&M)',
      name: escom.name,
      kn: escom.kn,
      short: escom.short,
      place: local.place,
      placeKn: local.placeKn,
    };
  }

  // City bodies have internal departments (roads, waste…) worth naming in the letter.
  const body = localBody(area);
  return { ...body, local: !body.noDepartments };
}

const ADDRESSEE_KN = {
  'The Commissioner': 'ಮಾನ್ಯ ಆಯುಕ್ತರು',
  'The Chief Commissioner': 'ಮಾನ್ಯ ಮುಖ್ಯ ಆಯುಕ್ತರು',
  'The Chief Engineer': 'ಮಾನ್ಯ ಮುಖ್ಯ ಎಂಜಿನಿಯರ್',
  'The Executive Engineer (O&M)': 'ಮಾನ್ಯ ಕಾರ್ಯನಿರ್ವಾಹಕ ಎಂಜಿನಿಯರ್ (ಕಾರ್ಯ ಮತ್ತು ಪಾಲನೆ)',
  'The Panchayat Development Officer': 'ಮಾನ್ಯ ಪಂಚಾಯಿತಿ ಅಭಿವೃದ್ಧಿ ಅಧಿಕಾರಿ',
};

export const addresseeKn = (authority) => ADDRESSEE_KN[authority.addressee] ?? 'ಮಾನ್ಯರು';
