export class ElementRegistry {
  private readonly elements = new Map<string, Element>();
  private generation = 0;
  private nextId = 1;

  beginObservation(): number {
    this.elements.clear();
    this.nextId = 1;
    this.generation += 1;
    return this.generation;
  }

  register(element: Element): string {
    const id = `e-${String(this.generation)}-${String(this.nextId)}`;
    this.nextId += 1;
    this.elements.set(id, element);
    return id;
  }

  resolve(generation: number, id: string): Element | null {
    if (generation !== this.generation) return null;
    const element = this.elements.get(id);
    return element?.isConnected === true ? element : null;
  }

  currentGeneration(): number {
    return this.generation;
  }
}
