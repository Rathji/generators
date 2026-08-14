// Minimal replacement for the npm `random` package (only random.int is used by OpenCiv).
const random = {
  int(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },
  float(min: number = 0, max: number = 1): number {
    return Math.random() * (max - min) + min;
  },
  bool(): boolean {
    return Math.random() < 0.5;
  },
};
export default random;

