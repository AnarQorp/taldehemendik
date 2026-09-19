export class DevService {
  constructor(client) {
    this.client = client;
  }

  async resetDataset() {
    return this.client.post("/dev/reset", {});
  }

  async emptyDatabase() {
    return this.client.post("/dev/empty", {});
  }
}
