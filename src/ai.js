import NetInfo from '@react-native-community/netinfo';
import * as FS from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import {initLlama} from 'llama.rn';
import {getDb, norm} from './db';

const DIR = FS.documentDirectory + 'models/';
export const MODEL = DIR + 'model.gguf';
export const MMPROJ = DIR + 'mmproj.gguf';
export const MODEL_URL = 'https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf';
export const MMPROJ_URL = 'https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf';

export const getGroqKey = async () => (await SecureStore.getItemAsync('groq')) || '';
export const setGroqKey = k => SecureStore.setItemAsync('groq', k || 'x').then(() => k ? 0 : SecureStore.deleteItemAsync('groq'));

export async function modelReady() {
  const a = await FS.getInfoAsync(MODEL), b = await FS.getInfoAsync(MMPROJ);
  return a.exists && b.exists;
}

export async function downloadModel(onProgress) {
  await FS.makeDirectoryAsync(DIR, {intermediates: true}).catch(() => {});
  for (const [i, [u, p]] of [[MODEL_URL, MODEL], [MMPROJ_URL, MMPROJ]].entries()) {
    const dl = FS.createDownloadResumable(u, p, {}, x => onProgress && onProgress(i, x.totalBytesWritten / x.totalBytesExpectedToWrite));
    await dl.downloadAsync();
  }
}

const SYSTEM = 'أنت مساعد بيطري محترف لدعم القرار السريري. حلل الحالة والصورة (إن وجدت) وقدم تشخيصات تفريقية مرتبة مع الأسباب، الفحوصات المقترحة، وخطة علاجية أولية. استند إلى المعلومات الطبية القياسية. وضح أن هذا استشارة مساعدة وليس بديلاً عن الفحص السريري المباشر. أجب باللغة العربية.';

async function viaGroq({b64, prompt, key}) {
  const content = [{type: 'text', text: prompt}];
  if (b64) content.push({type: 'image_url', image_url: {url: 'data:image/jpeg;base64,' + b64}});
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key},
    body: JSON.stringify({model: 'llama-3.2-11b-vision-preview', max_tokens: 1000, temperature: 0.3,
      messages: [{role: 'system', content: SYSTEM}, {role: 'user', content}]})
  });
  const j = await r.json();
  if (!j.choices) throw new Error(j.error?.message || 'Groq error');
  return j.choices[0].message.content;
}

let ctx;
async function getCtx() {
  if (ctx) return ctx;
  ctx = await initLlama({model: MODEL.replace('file://', ''), n_ctx: 4096, n_gpu_layers: 0});
  await ctx.initMultimodal({path: MMPROJ.replace('file://', ''), use_gpu: false});
  return ctx;
}

async function viaLocal({uri, prompt}) {
  const c = await getCtx();
  const content = [{type: 'text', text: prompt}];
  if (uri) content.push({type: 'image_url', image_url: {url: uri}});
  const r = await c.completion({messages: [{role: 'system', content: SYSTEM}, {role: 'user', content}], n_predict: 800, temperature: 0.3});
  return r.text;
}

export async function diagnose({c, uri, b64, groqKey}) {
  const prompt = `الحالة:\nالنوع: ${c.species || 'غير محدد'}\nالوزن: ${c.weight || '-'} كجم\nالأعراض: ${c.symptoms || '-'}`;
  let text = null, mode = null;
  const net = await NetInfo.fetch();
  const online = net.isConnected && net.isInternetReachable !== false;
  
  if (online && groqKey) {
    try { text = await viaGroq({b64, prompt, key: groqKey}); mode = 'online'; } catch (e) {}
  }
  if (text == null && await modelReady()) {
    try { text = await viaLocal({uri, prompt}); mode = 'local'; } catch (e) {}
  }
  if (text == null) {
    mode = 'offline';
    text = 'لا يوجد اتصال بالإنترنت أو مفتاح Groq، والموديل المحلي غير محمل. يرجى تحميل الموديل من الإعدادات أو إضافة مفتاح Groq.';
  }
  return {mode, text};
}
