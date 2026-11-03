// Vet Eye v2 - Added 50 references and 15 drugs
import React, {useState, useEffect} from 'react';
import {View, Text, TextInput, TouchableOpacity, ScrollView, FlatList, Image, Alert, StyleSheet, SafeAreaView, ActivityIndicator} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FS from 'expo-file-system/legacy';
import {searchDrugs, dosesOf, importDrugs, importRefs, searchRefs, saveCase, listCases, getKV, setKV, getDb} from './src/db';
import {SEED_DRUGS} from './src/seedDrugs';
import {SEED_REFS} from './src/seedRefs';
import {diagnose, downloadModel, modelReady, getGroqKey, setGroqKey} from './src/ai';
import {calcDose, fx} from './src/calc';
import {T} from './src/i18n';

const G = '#1b7f5c';
const Btn = ({t, onPress, style, disabled}) => (
  <TouchableOpacity style={[s.btn, style, disabled && {opacity: 0.5}]} onPress={onPress} disabled={disabled}>
    <Text style={s.bt}>{t}</Text>
  </TouchableOpacity>
);
const In = p => <TextInput style={s.in} placeholderTextColor="#888" {...p} />;

async function seedDatabase() {
  const seeded = await getKV('seeded_v1');
  if (seeded === 'true') return;
  try {
    await importDrugs(SEED_DRUGS.flatMap(d => d.doses.map(dose => ({...d, ...dose}))));
    await importRefs(SEED_REFS);
    await setKV('seeded_v1', 'true');
    console.log('Database seeded successfully');
  } catch (e) { console.error('Seed error:', e); }
}

export default function App() {
  const [lang, setLang] = useState('ar');
  const [tab, setTab] = useState('drugs');
  const [sel, setSel] = useState(null);
  const t = k => T[lang][k] || k;

  useEffect(() => {
    getKV('lang').then(v => v && setLang(v));
    seedDatabase();
  }, []);

  const tabs = ['drugs', 'calc', 'dx', 'refs', 'cases', 'set'];

  return (
    <SafeAreaView style={{flex: 1, backgroundColor: '#f4f7f5', paddingTop: 30}}>
      <View style={{flex: 1, padding: 10}}>
        {tab === 'drugs' && <Drugs t={t} onPick={d => {setSel(d); setTab('calc')}} />}
        {tab === 'calc' && <Calc t={t} drug={sel} />}
        {tab === 'dx' && <Dx t={t} />}
        {tab === 'refs' && <Refs t={t} />}
        {tab === 'cases' && <Cases t={t} />}
        {tab === 'set' && <Settings t={t} lang={lang} setLang={async l => {setLang(l); await setKV('lang', l)}} />}
      </View>
      <View style={s.tabs}>{tabs.map(k =>
        <TouchableOpacity key={k} style={[s.tab, tab === k && {backgroundColor: G}]} onPress={() => setTab(k)}>
          <Text style={{color: tab === k ? '#fff' : '#333', fontSize: 11}}>{t(k)}</Text>
        </TouchableOpacity>
      )}</View>
    </SafeAreaView>
  );
}

function Drugs({t, onPick}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  useEffect(() => { searchDrugs(q).then(setRows); }, [q]);
  return (
    <View style={{flex: 1}}>
      <In placeholder={t('search')} value={q} onChangeText={setQ} />
      <FlatList data={rows} keyExtractor={i => String(i.id)} renderItem={({item}) =>
        <TouchableOpacity style={s.card} onPress={() => onPick(item)}>
          <Text style={s.h}>{item.name_ar || item.name}</Text>
          <Text>{item.name}{item.active ? ' • ' + item.active : ''}</Text>
          <Text style={{color: '#666', fontSize: 12}}>{item.category}</Text>
        </TouchableOpacity>
      } />
    </View>
  );
}

function Calc({t, drug}) {
  const [doses, setDoses] = useState([]);
  const [i, setI] = useState(0);
  const [w, setW] = useState('');
  useEffect(() => { if (drug) dosesOf(drug.id).then(d => {setDoses(d); setI(0)}); }, [drug]);
  if (!drug) return <Text>{t('nodrug')}</Text>;
  const d = doses[i], kg = parseFloat(w);
  const r = d && kg > 0 ? calcDose(d, drug, kg) : null;
  return (
    <ScrollView>
      <Text style={s.h}>{drug.name_ar || drug.name}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginVertical: 4}}>
        {doses.map((x, j) =>
          <Btn key={x.id} t={x.species} style={{marginRight: 4, backgroundColor: j === i ? G : '#888'}} onPress={() => setI(j)} />
        )}
      </ScrollView>
      <In placeholder={t('weight')} keyboardType="numeric" value={w} onChangeText={setW} />
      {r && (
        <View style={s.card}>
          <Text style={s.h}>{t('res')}: {fx(r.mgMin)} - {fx(r.mgMax)} mg</Text>
          {r.mlMin != null && <Text>{t('vol')}: {fx(r.mlMin)} - {fx(r.mlMax)} ml</Text>}
          {r.tabMin != null && <Text>Tablets: {fx(r.tabMin)} - {fx(r.tabMax)}</Text>}
          <Text>{fx(d.min)}-{fx(d.max)} mg/kg • {d.route} • {d.freq}</Text>
        </View>
      )}
      <Text style={s.warn}>{t('disc')}</Text>
    </ScrollView>
  );
}

function Dx({t}) {
  const [img, setImg] = useState(null);
  const [c, setC] = useState({species: '', weight: '', symptoms: ''});
  const [out, setOut] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => v => setC({...c, [k]: v});
  const pick = async cam => {
    const o = {base64: true, quality: 0.5, mediaTypes: ['images']};
    const r = cam ? await ImagePicker.launchCameraAsync(o) : await ImagePicker.launchImageLibraryAsync(o);
    if (!r.canceled) setImg(r.assets[0]);
  };
  const run = async () => {
    setBusy(true); setOut(null);
    try {
      const key = await getGroqKey();
      setOut(await diagnose({c, uri: img?.uri, b64: img?.base64, groqKey: key}));
    } catch (e) { setOut({mode: 'err', text: e.message}); }
    setBusy(false);
  };
  return (
    <ScrollView>
      <View style={{flexDirection: 'row', gap: 4}}>
        <Btn t={t('pick')} style={{flex: 1}} onPress={() => pick(false)} />
        <Btn t={t('cam')} style={{flex: 1}} onPress={() => pick(true)} />
      </View>
      {img && <Image source={{uri: img.uri}} style={{height: 180, marginVertical: 6, borderRadius: 8}} />}
      <In placeholder={t('species')} value={c.species} onChangeText={set('species')} />
      <In placeholder={t('weight')} keyboardType="numeric" value={c.weight} onChangeText={set('weight')} />
      <In placeholder={t('symptoms')} multiline style={[s.in, {height: 100}]} value={c.symptoms} onChangeText={set('symptoms')} />
      <Btn t={t('analyze')} onPress={run} disabled={busy} />
      {busy && <ActivityIndicator style={{margin: 10}} color={G} />}
      {out && (
        <View style={s.card}>
          <Text style={{color: '#888'}}>[{out.mode === 'online' ? 'Online' : out.mode === 'local' ? 'Local' : 'Offline'}]</Text>
          <Text selectable>{out.text}</Text>
          <Btn t={t('save')} style={{marginTop: 8}} onPress={async () => { await saveCase({...c, diagnosis: out.text}); Alert.alert('✓'); }} />
        </View>
      )}
      <Text style={s.warn}>{t('disc')}</Text>
    </ScrollView>
  );
}

function Refs({t}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(null);
  useEffect(() => { searchRefs(q).then(setRows); }, [q]);
  return (
    <View style={{flex: 1}}>
      <In placeholder={t('search')} value={q} onChangeText={setQ} />
      <FlatList data={rows} keyExtractor={i => String(i.id)} renderItem={({item}) =>
        <TouchableOpacity style={s.card} onPress={() => setOpen(open === item.id ? null : item.id)}>
          <Text style={s.h}>{item.title}</Text>
          <Text style={{color: '#666', fontSize: 12}}>{item.category}</Text>
          <Text selectable>{open === item.id ? item.body : item.body.slice(0, 150) + '...'}</Text>
        </TouchableOpacity>
      } />
    </View>
  );
}

function Cases({t}) {
  const [rows, setRows] = useState([]);
  useEffect(() => { listCases().then(setRows); }, []);
  return (
    <View style={{flex: 1}}>
      <FlatList data={rows} keyExtractor={i => String(i.id)} renderItem={({item}) =>
        <View style={s.card}>
          <Text style={s.h}>{item.animal} ({item.species})</Text>
          <Text>{item.owner} • {item.created}</Text>
          <Text numberOfLines={2}>{item.symptoms}</Text>
        </View>
      } />
    </View>
  );
}

function Settings({t, lang, setLang}) {
  const [key, setKey] = useState('');
  const [ready, setReady] = useState(false);
  const [prog, setProg] = useState('');
  useEffect(() => { getGroqKey().then(setKey); modelReady().then(setReady); }, []);
  return (
    <ScrollView>
      <Btn t={t('lang')} onPress={() => setLang(lang === 'ar' ? 'en' : 'ar')} />
      <Text style={s.h}>{t('key')}</Text>
      <In secureTextEntry value={key} onChangeText={setKey} onEndEditing={() => setGroqKey(key)} placeholder="gsk_..." />
      <Text style={s.h}>{t('dlmodel')}</Text>
      <Btn t={(ready ? '✓ ' : '') + 'Download'} onPress={async () => {
        try {
          await downloadModel((i, p) => setProg(`${i === 0 ? 'Model' : 'Processor'}: ${(p * 100).toFixed(0)}%`));
          setReady(await modelReady());
          setProg('✓ Done');
        } catch (e) { Alert.alert('Error', e.message); }
      }} />
      <Text style={{color: G}}>{prog}</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  in: {backgroundColor: '#fff', borderRadius: 8, padding: 10, marginVertical: 4, fontSize: 16, borderWidth: 1, borderColor: '#ddd'},
  btn: {backgroundColor: G, padding: 12, borderRadius: 8, alignItems: 'center', marginVertical: 4},
  bt: {color: '#fff', fontWeight: 'bold', fontSize: 14},
  card: {backgroundColor: '#fff', borderRadius: 10, padding: 12, marginVertical: 4, elevation: 1},
  h: {fontWeight: 'bold', fontSize: 16, marginVertical: 4},
  warn: {color: '#a33', fontSize: 12, marginTop: 10, textAlign: 'center'},
  tabs: {flexDirection: 'row', borderTopWidth: 1, borderColor: '#eee'},
  tab: {flex: 1, padding: 12, alignItems: 'center'}
});
