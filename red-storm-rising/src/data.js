export const CLASSES = {
  'los-angeles': { name:'USS DALLAS SSN-700', side:'us', kind:'sub', maxSpeed:32, maxDepth:450, turnRate:4.0, maxAccel:2.0, baseNoise:4, noisePerKnot:0.55, sonar:true, activeRange:22, tubes:4, reload:75, loads:{mk48:14, harpoon:4}, reflect:0.65, value:0, lengthNm:0.012 },
  'victor':      { name:'VICTOR III SSN', side:'sov', kind:'sub', maxSpeed:30, maxDepth:400, turnRate:3.5, maxAccel:1.8, baseNoise:16, noisePerKnot:0.8, sonar:true, activeRange:14, tubes:6, reload:110, loads:{set65:6, t53:3}, reflect:0.75, value:8000, lengthNm:0.012 },
  'alfa':        { name:'ALFA SSN', side:'sov', kind:'sub', maxSpeed:41, maxDepth:700, turnRate:4.5, maxAccel:2.6, baseNoise:22, noisePerKnot:0.9, sonar:true, activeRange:12, tubes:6, reload:90, loads:{set65:6, t53:4}, reflect:0.7, value:9000, lengthNm:0.012 },
  'kilo':        { name:'KILO SS', side:'sov', kind:'sub', maxSpeed:17, maxDepth:300, turnRate:2.5, maxAccel:1.4, baseNoise:6, noisePerKnot:0.5, sonar:true, activeRange:10, tubes:6, reload:150, loads:{set65:4, t53:3}, reflect:0.7, value:6000, lengthNm:0.012 },
  'oscar':       { name:'OSCAR SSGN', side:'sov', kind:'sub', maxSpeed:28, maxDepth:300, turnRate:2.8, maxAccel:1.6, baseNoise:18, noisePerKnot:0.8, sonar:true, activeRange:14, tubes:4, reload:120, loads:{ssn19:12, set65:4}, reflect:0.7, value:15000, lengthNm:0.016 },
  'delta':       { name:'DELTA III SSBN', side:'sov', kind:'sub', maxSpeed:24, maxDepth:350, turnRate:2.2, maxAccel:1.4, baseNoise:17, noisePerKnot:0.7, sonar:true, activeRange:12, tubes:4, reload:150, loads:{set65:2}, reflect:0.75, value:18000, lengthNm:0.016 },
  'kirov':       { name:'KIROV CGN', side:'sov', kind:'surface', maxSpeed:32, turnRate:0.9, maxAccel:0.8, baseNoise:26, noisePerKnot:1.1, sonar:true, activeRange:18, loads:{ssn19:14, ssn15:6, rbu:8}, helos:1, radar:true, reflect:1.1, value:26000, lengthNm:0.03 },
  'slava':       { name:'SLAVA CG', side:'sov', kind:'surface', maxSpeed:34, turnRate:1.1, maxAccel:0.9, baseNoise:25, noisePerKnot:1.1, sonar:true, activeRange:16, loads:{ssn12:12, ssn15:4, rbu:6}, helos:1, radar:true, reflect:1.0, value:20000, lengthNm:0.025 },
  'sovremenny':  { name:'SOVREMENNY DDG', side:'sov', kind:'surface', maxSpeed:32, turnRate:1.2, maxAccel:0.9, baseNoise:24, noisePerKnot:1.0, sonar:true, activeRange:14, loads:{ssn22:8, ssn15:4, rbu:4}, radar:true, reflect:0.95, value:15000, lengthNm:0.022 },
  'udaloy':      { name:'UDALOY DDG', side:'sov', kind:'surface', maxSpeed:30, turnRate:1.2, maxAccel:0.9, baseNoise:25, noisePerKnot:1.0, sonar:true, activeRange:16, loads:{silex:8, rbu:6, lwt:4}, helos:2, radar:true, reflect:0.95, value:15000, lengthNm:0.022 },
  'krivak':      { name:'KRIVAK FFG', side:'sov', kind:'surface', maxSpeed:32, turnRate:1.3, maxAccel:0.9, baseNoise:23, noisePerKnot:1.0, sonar:true, activeRange:14, loads:{silex:4, rbu:4}, helos:1, radar:true, reflect:0.9, value:10000, lengthNm:0.019 },
  'kashin':      { name:'KASHIN DDG', side:'sov', kind:'surface', maxSpeed:35, turnRate:1.1, maxAccel:0.9, baseNoise:24, noisePerKnot:1.0, sonar:true, activeRange:12, loads:{ssn15:2, rbu:2}, radar:true, reflect:0.9, value:9000, lengthNm:0.02 },
  'merchant':    { name:'MERCHANT 20,000t', side:'sov', kind:'surface', maxSpeed:16, turnRate:0.8, maxAccel:0.5, baseNoise:42, noisePerKnot:1.3, sonar:false, activeRange:0, reflect:1.2, value:20000, lengthNm:0.03 },
  'perry':       { name:'OLIVER H. PERRY FFG', side:'us', kind:'surface', maxSpeed:29, turnRate:1.1, maxAccel:0.9, baseNoise:26, noisePerKnot:1.0, sonar:true, activeRange:15, loads:{lwt:4}, helos:1, radar:true, reflect:0.9, value:12000, lengthNm:0.019 },
  'ka27':        { name:'KA-27 HELIX', side:'sov', kind:'air', maxSpeed:90, turnRate:6, maxAccel:10, baseNoise:8, noisePerKnot:0.2, sonar:false, activeRange:0, loads:{buoy:8, lwt:2}, radar:true, reflect:0.3, value:500, lengthNm:0.008 },
  'buoy':        { name:'SONOBUOY', side:'sov', kind:'buoy', maxSpeed:0, turnRate:0, maxAccel:0, baseNoise:0, noisePerKnot:0, sonar:false, activeRange:0, reflect:0.05, value:0, lengthNm:0.001 },
};

export const WEAPONS = {
  mk48: { side:'us', name:'MK-48 ADCAP', kind:'torpedo', speeds:[{label:'FAST', speed:55, rng:15},{label:'SLOW', speed:40, rng:24}], turn:4.5, seeker:['passive','active'], activeRange:5.5, wire:true, warhead:270, depthCeil:600, wake:false, reflect:0.9 },
  harpoon: { side:'us', name:'HARPOON UGM-84', kind:'missile', speed:540, rangeNm:65, turn:1.2, seeker:['radar'], terminalRange:8, terminalCone:30, warhead:220, depthCeil:0, wake:false, reflect:0.5 },
  set65: { side:'sov', name:'SET-65', kind:'torpedo', speeds:[{label:'FAST', speed:40, rng:11}], turn:2.5, seeker:['passive','active'], activeRange:3.5, wire:false, warhead:205, depthCeil:450, wake:false, reflect:0.9 },
  t53: { side:'sov', name:'TYPE 53-65', kind:'torpedo', speeds:[{label:'FAST', speed:45, rng:13}], turn:3.0, seeker:['wake'], activeRange:0, wire:false, warhead:305, depthCeil:180, wake:true, reflect:0.9 },
  lwt: { side:'sov', name:'ASW LIGHTWEIGHT TORP', kind:'torpedo', speeds:[{label:'FAST', speed:30, rng:5}], turn:3.5, seeker:['active'], activeRange:2.2, wire:false, warhead:45, depthCeil:150, wake:false, reflect:0.8 },
  ssn15: { side:'sov', name:'SS-N-15 STARFISH', kind:'rocket', speed:380, rangeNm:12, turn:1.5, delivers:'set65', warhead:0, reflect:0.3 },
  silex: { side:'sov', name:'SS-N-14 SILEX', kind:'rocket', speed:320, rangeNm:14, turn:1.5, delivers:'set65', warhead:0, reflect:0.3 },
  rbu: { side:'sov', name:'RBU-6000', kind:'rocket', speed:150, rangeNm:3.2, turn:1, direct:true, warhead:55, directRadius:0.3, reflect:0.4 },
  ssn19: { side:'sov', name:'SS-N-19 SHIPWRECK', kind:'missile', speed:650, rangeNm:240, turn:3.0, seeker:['radar'], terminalRange:10, terminalCone:25, warhead:750, depthCeil:0, wake:false, reflect:0.4 },
  ssn12: { side:'sov', name:'SS-N-12 SANDBOX', kind:'missile', speed:550, rangeNm:300, turn:2.0, seeker:['radar'], terminalRange:9, terminalCone:25, warhead:500, depthCeil:0, wake:false, reflect:0.4 },
  ssn22: { side:'sov', name:'SS-N-22 SUNBURN', kind:'missile', speed:640, rangeNm:70, turn:3.5, seeker:['radar'], terminalRange:8, terminalCone:20, warhead:300, depthCeil:0, wake:false, reflect:0.4 },
};

export const REPAIR_RATE = 0.6;
export const DECOY_COUNT = 4;
export const NOISEMAKER_COUNT = 4;
export const LAUNCH_DETECT_RANGE = 30;
