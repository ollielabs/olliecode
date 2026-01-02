// test-file3.ts
// Takes exactly 5 numbers, sums them, and divides the sum by a provided divider.

/**
 * Calculates (a + b + c + d + e) / divider.
 * @param numbers An array of exactly five numbers.
 * @param divider The number to divide the sum by. Must not be zero.
 * @returns The result of the division.
 * @throws If the numbers array does not contain exactly five elements or if divider is zero.
 */
export function divideSumByDivider(numbers: number[], divider: number): number {
  if (numbers.length !== 5) {
    throw new Error('Exactly five numbers are required');
  }
  if (divider === 0) {
    throw new Error('Divider cannot be zero');
  }
  const sum = numbers.reduce((acc, cur) => acc + cur, 0);
  return sum / divider;
}

// Example usage (uncomment to run):
// const result = divideSumByDivider([1, 2, 3, 4, 5], 3);
// console.log(result); // Outputs 5
