/*MIT License

Copyright (c) 2018 Juan Hernández Serrano

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

let SEED;

/**
 * Absolute value. abs(a)==a if a>=0. abs(a)==-a if a<0
 *
 * @param {number|bigint} a
 *
 * @returns {bigint} the absolute value of a
 */
function abs (a) {
  a = BigInt(a)
  return (a >= 0n) ? a : -a
}

/**
 * Returns the bitlength of a number
 *
 * @param {number|bigint} a
 * @returns {number} - the bit length
 */
function bitLength (a) {
  a = BigInt(a)
  if (a === 1n) { return 1 }
  let bits = 1
  do {
    bits++
  } while ((a >>= 1n) > 1n)
  return bits
}

/**
 * @typedef {Object} egcdReturn A triple (g, x, y), such that ax + by = g = gcd(a, b).
 * @property {bigint} g
 * @property {bigint} x
 * @property {bigint} y
 */
/**
 * An iterative implementation of the extended euclidean algorithm or extended greatest common divisor algorithm.
 * Take positive integers a, b as input, and return a triple (g, x, y), such that ax + by = g = gcd(a, b).
 *
 * @param {number|bigint} a
 * @param {number|bigint} b
 *
 * @throws {RangeError} a and b MUST be > 0
 *
 * @returns {egcdReturn} A triple (g, x, y), such that ax + by = g = gcd(a, b).
 */
function eGcd (a, b) {
  a = BigInt(a)
  b = BigInt(b)
  if (a <= 0n | b <= 0n) throw new RangeError('a and b MUST be > 0') // a and b MUST be positive

  let x = 0n
  let y = 1n
  let u = 1n
  let v = 0n

  while (a !== 0n) {
    const q = b / a
    const r = b % a
    const m = x - (u * q)
    const n = y - (v * q)
    b = a
    a = r
    x = u
    y = v
    u = m
    v = n
  }
  return {
    g: b,
    x: x,
    y: y
  }
}

/**
 * Greatest-common divisor of two integers based on the iterative binary algorithm.
 *
 * @param {number|bigint} a
 * @param {number|bigint} b
 *
 * @returns {bigint} The greatest common divisor of a and b
 */
function gcd (a, b) {
  a = abs(a)
  b = abs(b)
  if (a === 0n) { return b } else if (b === 0n) { return a }

  let shift = 0n
  while (!((a | b) & 1n)) {
    a >>= 1n
    b >>= 1n
    shift++
  }
  while (!(a & 1n)) a >>= 1n
  do {
    while (!(b & 1n)) b >>= 1n
    if (a > b) {
      const x = a
      a = b
      b = x
    }
    b -= a
  } while (b)

  // rescale
  return a << shift
}

/**
 * The least common multiple computed as abs(a*b)/gcd(a,b)
 * @param {number|bigint} a
 * @param {number|bigint} b
 *
 * @returns {bigint} The least common multiple of a and b
 */
function lcm (a, b) {
  a = BigInt(a)
  b = BigInt(b)
  if (a === 0n && b === 0n) return BigInt(0)
  return abs(a * b) / gcd(a, b)
}

/**
 * Maximum. max(a,b)==a if a>=b. max(a,b)==b if a<=b
 *
 * @param {number|bigint} a
 * @param {number|bigint} b
 *
 * @returns {bigint} maximum of numbers a and b
 */
function max (a, b) {
  a = BigInt(a)
  b = BigInt(b)
  return (a >= b) ? a : b
}

/**
 * Minimum. min(a,b)==b if a>=b. min(a,b)==a if a<=b
 *
 * @param {number|bigint} a
 * @param {number|bigint} b
 *
 * @returns {bigint} minimum of numbers a and b
 */
function min (a, b) {
  a = BigInt(a)
  b = BigInt(b)
  return (a >= b) ? b : a
}

/**
 * Modular inverse.
 *
 * @param {number|bigint} a The number to find an inverse for
 * @param {number|bigint} n The modulo
 *
 * @throws {RangeError} a does not have inverse modulo n
 *
 * @returns {bigint} the inverse modulo n
 */
function modInv (a, n) {
  const egcd = eGcd(toZn(a, n), n)
  if (egcd.g !== 1n) {
    throw new RangeError(`${a.toString()} does not have inverse modulo ${n.toString()}`) // modular inverse does not exist
  } else {
    return toZn(egcd.x, n)
  }
}

/**
 * Modular exponentiation b**e mod n. Currently using the right-to-left binary method
 *
 * @param {number|bigint} b base
 * @param {number|bigint} e exponent
 * @param {number|bigint} n modulo
 *
 * @returns {bigint} b**e mod n
 */
function modPow (b, e, n) {
  n = BigInt(n)
  if (n === 0n) { throw new RangeError('n must be > 0') } else if (n === 1n) { return BigInt(0) }

  b = toZn(b, n)

  e = BigInt(e)
  if (e < 0n) {
    return modInv(modPow(b, abs(e), n), n)
  }

  let r = 1n
  while (e > 0) {
    if ((e % 2n) === 1n) {
      r = (r * b) % n
    }
    e = e / 2n
    b = b ** 2n % n
  }
  return r
}

/**
 * Finds the smallest positive element that is congruent to a in modulo n
 * @param {number|bigint} a An integer
 * @param {number|bigint} n The modulo
 *
 * @returns {bigint} The smallest positive representation of a in modulo n
 */
function toZn (a, n) {
  n = BigInt(n)
  if (n <= 0) { return NaN }

  a = BigInt(a) % n
  return (a < 0) ? a + n : a
}


/**
 * The test first tries if any of the first 250 small primes are a factor of the input number and then passes several
 * iterations of Miller-Rabin Probabilistic Primality Test (FIPS 186-4 C.3.1)
 *
 * @param {number | bigint} w A positive integer to be tested for primality
 * @param {number} [iterations = 16] The number of iterations for the primality test. The value shall be consistent with Table C.1, C.2 or C.3
 *
 * @throws {RangeError} w MUST be >= 0
 *
 * @returns {Promise<boolean>} A promise that resolves to a boolean that is either true (a probably prime number) or false (definitely composite)
 */
function isProbablyPrime (w, iterations = 16) {
  if (typeof w === 'number') {
    w = BigInt(w)
  }
  if (w < 0) throw RangeError('w MUST be >= 0')
  /* eslint-disable no-lone-blocks */
      return new Promise((resolve) => {
        resolve(_isProbablyPrime(w, iterations))
      })
}

/* HELPER FUNCTIONS */

function fromBuffer (buf) {
  let ret = 0n
  for (const i of buf.values()) {
    const bi = BigInt(i)
    ret = (ret << BigInt(8)) + bi
  }
  return ret
}

/**
 * Secure random bits for both node and browsers. Node version uses crypto.randomFill() and browser one self.crypto.getRandomValues()
 * @param {number} bitLength The desired number of random bits
 * @param {boolean} [forceLength = false] If we want to force the output to have a specific bit length. It basically forces the msb to be 1
 *
 * @throws {RangeError} bitLength MUST be > 0
 *
 * @returns {Buffer | Uint8Array} A Buffer/UInt8Array (Node.js/Browser) filled with cryptographically secure random bits
 */
function randBitsSync (bitLength, forceLength = false) {
    if (bitLength < 1) throw new RangeError('bitLength MUST be > 0')
  
    const byteLength = Math.ceil(bitLength / 8)
    const rndBytes = randBytesSync(byteLength, false)
    const bitLengthMod8 = bitLength % 8
    if (bitLengthMod8) {
      // Fill with 0's the extra bits
      rndBytes[0] = rndBytes[0] & (2 ** bitLengthMod8 - 1)
    }
    if (forceLength) {
      const mask = bitLengthMod8 ? 2 ** (bitLengthMod8 - 1) : 128
      rndBytes[0] = rndBytes[0] | mask
    }
    return rndBytes
  }

  /**
 * Secure random bytes for both node and browsers. Node version uses crypto.randomFill() and browser one self.crypto.getRandomValues()
 *
 * @param {number} byteLength The desired number of random bytes
 * @param {boolean} [forceLength = false] If we want to force the output to have a bit length of 8*byteLength. It basically forces the msb to be 1
 *
 * @throws {RangeError} byteLength MUST be > 0
 *
 * @returns {Buffer | Uint8Array} A Buffer/UInt8Array (Node.js/Browser) filled with cryptographically secure random bytes
 */

function randBytesSync (byteLength, forceLength = false) {
    if (byteLength < 1) throw new RangeError('byteLength MUST be > 0')

    let blen = 0;
      let bleft = byteLength;
      let buf = new Uint8Array(byteLength);
      if(!SEED) {
         SEED = new Uint8Array(32);
         self.crypto.getRandomValues(SEED); // avoid using extensive amount of secure random
      }
      let val = new BLAKE2s(32, SEED);

      while(bleft > 0) {
        for(let i = 0; i < 32; i++) {
             let v = val.digest();
             buf[blen++] = v[i] 
             bleft--;
             if(0 == bleft) {
                SEED = val.digest();
                break;
             }
             val = new BLAKE2s(32, val.digest());
        }
      }

      // If fixed length is required we put the first bit to 1 -> to get the necessary bitLength
      if (forceLength) buf[0] = buf[0] | 128
      return buf

    /* eslint-enable no-lone-blocks */
  }

/**
 * Returns a cryptographically secure random integer between [min,max]. Both numbers must be >=0
 * @param {bigint} max Returned value will be <= max
 * @param {bigint} [min = BigInt(1)] Returned value will be >= min
 *
 * @throws {RangeError} Arguments MUST be: max > 0 && min >=0 && max > min
 *
 * @returns {bigint} A cryptographically secure random bigint between [min,max]
 */
function randBetween (max, min = 1n) {
    if (max <= 0n || min < 0n || max <= min) throw new RangeError('Arguments MUST be: max > 0 && min >=0 && max > min')
    const interval = max - min
    const bitLen = bitLength(interval)
    let rnd
    do {
      const buf = randBitsSync(bitLen)
      rnd = fromBuffer(buf)
    } while (rnd > interval)
    return rnd + min
  }

function _isProbablyPrime (w, iterations = 16) {
  /*
  PREFILTERING. Even values but 2 are not primes, so don't test.
  1 is not a prime and the M-R algorithm needs w>1.
  */
  if (w === 2n) return true
  else if ((w & 1n) === 0n || w === 1n) return false

  /*
    Test if any of the first 250 small primes are a factor of w. 2 is not tested because it was already tested above.
    */
   const firstPrimes = [
    3n,
    5n,
    7n,
    11n,
    13n,
    17n,
    19n,
    23n,
    29n,
    31n,
    37n,
    41n,
    43n,
    47n,
    53n,
    59n,
    61n,
    67n,
    71n,
    73n,
    79n,
    83n,
    89n,
    97n,
    101n,
    103n,
    107n,
    109n,
    113n,
    127n,
    131n,
    137n,
    139n,
    149n,
    151n,
    157n,
    163n,
    167n,
    173n,
    179n,
    181n,
    191n,
    193n,
    197n,
    199n,
    211n,
    223n,
    227n,
    229n,
    233n,
    239n,
    241n,
    251n,
    257n,
    263n,
    269n,
    271n,
    277n,
    281n,
    283n,
    293n,
    307n,
    311n,
    313n,
    317n,
    331n,
    337n,
    347n,
    349n,
    353n,
    359n,
    367n,
    373n,
    379n,
    383n,
    389n,
    397n,
    401n,
    409n,
    419n,
    421n,
    431n,
    433n,
    439n,
    443n,
    449n,
    457n,
    461n,
    463n,
    467n,
    479n,
    487n,
    491n,
    499n,
    503n,
    509n,
    521n,
    523n,
    541n,
    547n,
    557n,
    563n,
    569n,
    571n,
    577n,
    587n,
    593n,
    599n,
    601n,
    607n,
    613n,
    617n,
    619n,
    631n,
    641n,
    643n,
    647n,
    653n,
    659n,
    661n,
    673n,
    677n,
    683n,
    691n,
    701n,
    709n,
    719n,
    727n,
    733n,
    739n,
    743n,
    751n,
    757n,
    761n,
    769n,
    773n,
    787n,
    797n,
    809n,
    811n,
    821n,
    823n,
    827n,
    829n,
    839n,
    853n,
    857n,
    859n,
    863n,
    877n,
    881n,
    883n,
    887n,
    907n,
    911n,
    919n,
    929n,
    937n,
    941n,
    947n,
    953n,
    967n,
    971n,
    977n,
    983n,
    991n,
    997n,
    1009n,
    1013n,
    1019n,
    1021n,
    1031n,
    1033n,
    1039n,
    1049n,
    1051n,
    1061n,
    1063n,
    1069n,
    1087n,
    1091n,
    1093n,
    1097n,
    1103n,
    1109n,
    1117n,
    1123n,
    1129n,
    1151n,
    1153n,
    1163n,
    1171n,
    1181n,
    1187n,
    1193n,
    1201n,
    1213n,
    1217n,
    1223n,
    1229n,
    1231n,
    1237n,
    1249n,
    1259n,
    1277n,
    1279n,
    1283n,
    1289n,
    1291n,
    1297n,
    1301n,
    1303n,
    1307n,
    1319n,
    1321n,
    1327n,
    1361n,
    1367n,
    1373n,
    1381n,
    1399n,
    1409n,
    1423n,
    1427n,
    1429n,
    1433n,
    1439n,
    1447n,
    1451n,
    1453n,
    1459n,
    1471n,
    1481n,
    1483n,
    1487n,
    1489n,
    1493n,
    1499n,
    1511n,
    1523n,
    1531n,
    1543n,
    1549n,
    1553n,
    1559n,
    1567n,
    1571n,
    1579n,
    1583n,
    1597n
  ]

  for (let i = 0; i < firstPrimes.length && (firstPrimes[i] <= w); i++) {
    const p = firstPrimes[i]
    if (w === p) return true
    else if (w % p === 0n) return false
  }

  /*
    1. Let a be the largest integer such that 2**a divides w−1.
    2. m = (w−1) / 2**a.
    3. wlen = len (w).
    4. For i = 1 to iterations do
        4.1 Obtain a string b of wlen bits from an RBG.
        Comment: Ensure that 1 < b < w−1.
        4.2 If ((b ≤ 1) or (b ≥ w−1)), then go to step 4.1.
        4.3 z = b**m mod w.
        4.4 If ((z = 1) or (z = w − 1)), then go to step 4.7.
        4.5 For j = 1 to a − 1 do.
        4.5.1 z = z**2 mod w.
        4.5.2 If (z = w−1), then go to step 4.7.
        4.5.3 If (z = 1), then go to step 4.6.
        4.6 Return COMPOSITE.
        4.7 Continue.
        Comment: Increment i for the do-loop in step 4.
    5. Return PROBABLY PRIME.
    */
  let a = 0n
  const d = w - 1n
  let aux = d
  while (aux % 2n === 0n) {
    aux /= 2n
    ++a
  }

  const m = d / (2n ** a)

  do {
    const b = randBetween(d, 2n)
    let z = modPow(b, m, w)
    if (z === 1n || z === d) continue
    let j = 1
    while (j < a) {
      z = modPow(z, 2n, w)
      if (z === d) break
      if (z === 1n) return false
      j++
    }
    if (z !== d) return false
  } while (--iterations)

  return true
}
