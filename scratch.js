const aiService = require('./server/services/ai-service');
const ollama = require('./server/services/ollama-client');

async function test() {
  try {
    const res = await aiService.generateOverallAnalysis([{ overview: 'test summary' }]);
    console.log('Success:', res);
  } catch (err) {
    console.error('Failed:', err);
  }
}
test();
