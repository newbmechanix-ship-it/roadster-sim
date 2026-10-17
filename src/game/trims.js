// Trim data. Tesla's published figures are in `spec`; physics values are
// game estimates tuned so the simulated 0-60 matches Tesla's claims.
const G = 9.81;

export const TRIMS = {
  performance: {
    id: 'performance',
    name: 'Performance',
    tagline: 'Road ready',
    spec: { seats: '2', zeroSixty: '< 1.6 s', topSpeed: '~195 mph (est.)', range: '300+ mi', thrusters: 'None', availability: 'Reservation' },
    mass: 1750,
    power: 900e3,        // W, est.
    vmax: 90,            // m/s ≈ 201 mph (est.)
    mu: 1.55,            // peak tire friction at nominal load (load-sensitive in Vehicle)
    fanForce: 0.55 * 1750 * G, // suction fan downforce (N)
    clA: 2.2,            // downforce coefficient × area (L/D ≈ 3, realistic)
    cdA: 0.7,
    rearThrust: 0,
    assistThrust: 0,
    maxDriveG: 1.75,     // motor torque cap (g)
    liftThrust: 0,
    tank: 0,             // air tank impulse (N·s)
    refill: 0,
    airControl: 0.15,
    wing: true,          // same retractable wing as the other trims (stowed in Tesla's renders)
    perimeter: false,
  },
  thrust: {
    id: 'thrust',
    name: 'Thrust',
    tagline: 'Race ready',
    spec: { seats: '2', zeroSixty: '< 0.9 s', topSpeed: '220+ mph (est.)', range: '300+ mi', thrusters: 'Rear cold-gas ×4', availability: 'Limited release' },
    mass: 1820,
    power: 1000e3,
    vmax: 98,
    mu: 1.55,
    fanForce: 0.55 * 1820 * G,
    clA: 3.0,
    cdA: 0.85,
    rearThrust: 19500,
    assistThrust: 0,     // rear-facing nozzles only: can't brake or corner
    maxDriveG: 2.6,
    liftThrust: 0,
    tank: 90e3,          // N·s: ~30 kN·s physically plausible × 3 gameplay multiplier
    refill: 60,          // N·s per s: onboard compressor (~0.03 kg/s × 600 m/s × 3)
    airControl: 0.25,
    wing: true,
    perimeter: false,
  },
  rocket: {
    id: 'rocket',
    name: 'Rocket',
    tagline: 'Air ready',
    spec: { seats: '1', zeroSixty: '< 0.59 s', topSpeed: '230+ mph', range: '300+ mi', thrusters: 'Rear + perimeter cold-gas', availability: 'Invite only · not road legal' },
    mass: 1880,
    power: 1100e3,
    vmax: 104,           // ≈ 233 mph
    mu: 1.55,
    fanForce: 0.55 * 1880 * G,
    clA: 3.0,
    cdA: 0.85,
    rearThrust: 54000,
    assistThrust: 30000, // perimeter jets: braking / cornering assist (~1.6 g)
    maxDriveG: 2.6,
    liftThrust: 1.45 * 1880 * G,
    tank: 175e3,         // N·s: ~58 kN·s (250 L @ 700 bar) × 3 gameplay multiplier
    refill: 60,
    airControl: 1.0,
    wing: true,
    perimeter: true,
  },
};
