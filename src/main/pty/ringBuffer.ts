export class RingBuffer {
  private chunks: string[] = []
  private size = 0

  constructor(private readonly max = 512 * 1024) {}

  push(s: string): void {
    this.chunks.push(s)
    this.size += s.length
    while (this.size > this.max && this.chunks.length > 1) {
      this.size -= this.chunks.shift()!.length
    }
    if (this.size > this.max) {
      this.chunks[0] = this.chunks[0].slice(this.chunks[0].length - this.max)
      this.size = this.max
    }
  }

  toString(): string {
    return this.chunks.join('')
  }
}
