export type Task<T> = () => Promise<T>;

export const createThrottler = (maxConcurrency: number) => {
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new Error('maxConcurrency must be a positive integer')
  }

  let activeCount = 0
  const queue: Array<() => void> = []

  const next = () => {
    if (activeCount >= maxConcurrency) {
      return
    }

    const task = queue.shift()
    if (!task) {
      return
    }

    activeCount += 1
    task()
  }

  const enqueue = <T>(taskFn: Task<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        taskFn()
          .then(resolve)
          .catch(reject)
          .finally(() => {
            activeCount -= 1
            next()
          })
      }

      queue.push(run)
      next()
    })
  }

  return enqueue
}
