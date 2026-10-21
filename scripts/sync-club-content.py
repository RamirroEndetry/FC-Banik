"""Refresh public roster/profile facts, partner images and club history from the official club site fcb.cz.

Usage: python scripts/sync-club-content.py [--history-only]
"""
import io
import sys
import concurrent.futures
import importlib.util
import datetime
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
BASE = 'https://www.fcb.cz'
ALLOWED = {'www.fcb.cz', 'fcb.cz'}
AGENT = 'BanikVIP-ContentSync/1.0'
SEASON = '2027'  # fcb.cz names a season by the year it ends: 2027 = 2026/27
POSITIONS = {'Brankáři': 'Brankář', 'Obránci': 'Obránce', 'Záložníci': 'Záložník', 'Útočníci': 'Útočník'}

class Node:
    def __init__(self, tag='', attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []
    def all(self, tag=None):
        for child in self.children:
            if isinstance(child, Node):
                if tag is None or child.tag == tag:
                    yield child
                yield from child.all(tag)
    def first(self, tag):
        return next(self.all(tag), None)
    def classes(self):
        return self.attrs.get('class', '').split()
    def text(self):
        return re.sub(r'\s+', ' ', ''.join(c.text() if isinstance(c, Node) else c for c in self.children)).strip()

class Tree(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = Node('root')
        self.stack = [self.root]
        self.feed(html)
    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}:
            self.stack.append(node)
    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)
    def handle_endtag(self, tag):
        for i in range(len(self.stack)-1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break
    def handle_data(self, text):
        self.stack[-1].children.append(text)

def read(url):
    if urllib.parse.urlparse(url).hostname not in ALLOWED:
        raise ValueError('Unexpected content host: '+url)
    url = urllib.parse.quote(url, safe=':/?&=%#')
    req = urllib.request.Request(url, headers={'User-Agent': AGENT})
    with urllib.request.urlopen(req, timeout=25) as response:
        if urllib.parse.urlparse(response.url).hostname not in ALLOWED:
            raise ValueError('Unexpected redirect')
        return response.read(12*1024*1024), response.headers.get_content_type(), response.headers.get_content_charset()

def page(url):
    data, _, charset = read(url)
    # fcb.cz serves windows-1250 pages.
    return Tree(data.decode(charset or 'windows-1250', errors='replace')).root

def by_class(node, name, tag=None):
    return [n for n in node.all(tag) if name in n.classes()]

def clean(text):
    return re.sub(r'\s+', ' ', text).strip()

_spec = importlib.util.spec_from_file_location('trim_partner_logos', Path(__file__).with_name('trim-partner-logos.py'))
_trim = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_trim)

def image(url):
    from PIL import Image
    data, kind, _ = read(urllib.parse.urljoin(BASE+'/', url))
    if not kind.startswith('image/'):
        raise ValueError('Not an image: '+url)
    return Image.open(io.BytesIO(data))

def club_logo():
    """The 500 px crest from the site header, cropped to its shield (the list icon is only 100 px)."""
    from PIL import Image
    im = image('/img/fcb_logo_original.png').convert('RGBA')
    crop = im.crop(im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())
    out = Image.new('RGBA', (crop.width+12, crop.height+12), (0, 0, 0, 0))
    out.paste(crop, (6, 6))
    out.save(ROOT/'dist'/'assets'/'club-logo.png', optimize=True)

def player_photo(url, pid):
    """Cut-out PNG portraits (1500x2048) scaled to 900 px height, alpha kept for the intro video."""
    im = image(url).convert('RGBA')
    im.thumbnail((900, 900*im.height//im.width if im.width > im.height else 900))
    relative = Path('assets')/'players'/f'{pid}.png'
    (ROOT/'dist'/relative).parent.mkdir(parents=True, exist_ok=True)
    im.save(ROOT/'dist'/relative, optimize=True)
    return relative.as_posix()

STAT_LABELS = {'Z': 'Zápasy', 'MIN': 'Minuty', 'G': 'Góly', 'ŽK': 'Žluté karty', 'ČK': 'Červené karty', 'A': 'Asistence', 'IN': 'Inkasované góly', 'ČČ': 'Čistá konta'}

def profile(item):
    root = page(item['source'])
    bio = {}
    for box in by_class(root, 'player__header__bio', 'div'):
        label, value = by_class(box, 'player__header__bio-label'), by_class(box, 'player__header__bio-value')
        if label and value:
            bio[label[0].text()] = value[0].text()
    competitions, stats = [], {}
    table = next((t for t in root.all('table') if 'stats' in t.classes()), None)
    if table:
        rows = list(table.all('tr'))
        head = [c.text() for c in rows[0].all('th')] if rows else []
        for row in rows[1:]:
            cells = [c.text() for c in row.all('td')]
            if len(cells) != len(head) or not cells[0]:
                continue
            values = {STAT_LABELS.get(h, h): v for h, v in zip(head[1:], cells[1:])}
            competitions.append({'label': cells[0], 'values': values})
            if cells[0].startswith('Chance Liga'):
                stats = values
    measurements = ' / '.join(v for v in (bio.get('Výška'), bio.get('Váha')) if v and v.strip('- '))
    # "2.9.1999 (27 let)": keep the date only, the age would go stale.
    born = re.sub(r'(\d+)\.(\d+)\.(\d{4})', r'\1. \2. \3', bio.get('Narozen', '').split('(')[0].strip())
    photo = next((i.attrs['src'] for i in root.all('img') if '/foto/hraci/' in i.attrs.get('src', '') and '/big/' in i.attrs.get('src', '')), None)
    photo = re.search(r'file=(https?://[^&]+)', photo).group(1) if photo and 'file=' in photo else photo
    result = {**item, 'born': born, 'measurements': measurements, 'nationality': bio.get('Národnost', ''), 'stats': stats, 'competitions': competitions, 'photo': ''}
    if photo:
        photo = photo.replace('//foto', '/foto')
        for url in (photo, photo.replace('/big/', '/small/')):
            try:
                result['photo'] = player_photo(url, item['id'])
                result['photoSource'] = url  # full-size original, used by scripts/render-intro.py
                break
            except Exception as error:  # a broken portrait on the club site must not stop the import
                print('player photo skipped:', url, error)
    return result

def roster():
    root = page(f'{BASE}/soupiska.asp?kategorie=MUZ&sezona={SEASON}')
    content = next(n for n in root.all('div') if 'content' in n.classes() and n.first('h2'))
    players, position = [], ''
    def walk(node):
        nonlocal position
        for child in node.children:
            if not isinstance(child, Node):
                continue
            if child.tag == 'h2' and child.text() in POSITIONS:
                position = POSITIONS[child.text()]
            elif 'roster__item' in child.classes():
                link = child.first('h3').first('a')
                href = link.attrs['href']
                pid = re.search(r'-(\d+)(?:&|$)', href).group(1)
                number = child.first('b').text() if child.first('b') else ''
                players.append({'id': pid, 'name': link.text(), 'number': number, 'position': position, 'source': urllib.parse.urljoin(BASE+'/', href.split('&')[0])})
            else:
                walk(child)
    walk(content)
    return players

def partners():
    from PIL import Image
    root = page(BASE+'/partneri.asp')
    found, category = [], ''
    def walk(node):
        nonlocal category
        for child in node.children:
            if not isinstance(child, Node):
                continue
            if child.tag == 'h2':
                category = child.text()
            elif child.tag == 'img' and 'db_partners/logos/' in child.attrs.get('data-src', child.attrs.get('src', '')):
                found.append((category, child))
            else:
                walk(child)
    walk(root)
    result, seen = [], set()
    for category, img in found:
        source = urllib.parse.urljoin(BASE+'/', img.attrs.get('data-src') or img.attrs['src'])
        identity = hashlib.sha256(urllib.parse.urlsplit(source).path.lower().encode()).hexdigest()[:12]
        if identity in seen:
            continue
        seen.add(identity)
        result.append({'id': identity, 'name': img.attrs.get('alt', 'Partner klubu').strip(), 'category': category, 'sourceLogo': source})
    def download(partner):
        im = image(partner['sourceLogo'])
        relative = Path('assets')/'partners'/(partner['id']+'.png')
        target = ROOT/'dist'/relative
        target.parent.mkdir(parents=True, exist_ok=True)
        im.convert('RGBA').save(target)
        _trim.trim(target)
        return {**partner, 'logo': relative.as_posix()}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        return list(pool.map(download, result))

# The club history on fcb.cz is one long narrative. The kiosk shows a short timeline written from it:
# (year, title, summary, section on fcb.cz whose first photo illustrates the milestone).
MILESTONES = [
    (1922, 'Založení v hostinci U dubu', 'Osmého září 1922 se v hostinci U dubu sešli nadšenci a založili SK Slezská Ostrava. Ze dvaceti podepsaných zakladatelů bylo šestnáct horníků.', None),
    (1923, 'První zápas a modrobílé barvy', 'Čtvrtého března 1923 odehrála Slezská první zápas na Nové střelnici a první gól dal Jóža Dvořák. Po třech zápasech v červenobílých pruzích přijal klub barvy modrou a bílou.', 'První střelec Jóža Dvořák'),
    (1934, 'Domovem Stará střelnice', 'Klub postoupil do divize a našel domov na škvárovém hřišti Staré střelnice. Premiéru tam odehrál 12. srpna 1934 proti DSV Troppau (2:2).', None),
    (1936, 'Poprvé mezi elitou', 'Po vítězné divizi zvládla Slezská kvalifikaci a výhrou nad Pardubicemi před 12 tisíci diváky poprvé postoupila do nejvyšší soutěže.', None),
    (1952, 'Rodí se Baník', 'Po válce a únoru 1948 klub několikrát měnil jméno. V roce 1952 se v názvu poprvé objevil Baník a začala jeho slavná éra.', None),
    (1955, 'První ligová medaile', 'Trenér Jaroslav Šimonek dovedl Baník ke stříbru, za mistrovskou Spartou zaostal o pouhé dva body.', None),
    (1959, 'Nové Bazaly a cesta do Anglie', 'Baník se dočkal stadionu Bazaly a poprvé vyrazil do kolébky fotbalu – v Anglii se utkal mimo jiné s Evertonem a Leeds.', None),
    (1962, 'Semifinále Rappanova poháru', 'Ve druhém ročníku předchůdce Interpoháru došel Baník až do semifinále. V Rotterdamu ho vyřadil gól Feyenoordu v poslední minutě.', 'Nad síly až Feyenoord'),
    (1966, 'Jediný sestup na půl století', 'Po podzimním prvenství v sezóně 1961/1962 přišel generační útlum a v roce 1966 sestup. V druhé lize strávil Baník jen jediný rok.', None),
    (1970, 'Premiéra v evropských pohárech', 'V sezóně 1969/1970 si Baník poprvé zahrál oficiální evropský pohár, v Poháru vítězů pohárů s portugalskou Vitórií Guimarães.', None),
    (1975, 'Čtvrtfinále Poháru UEFA', 'Přes Real Sociedad, Nantes a Neapol došel Baník do čtvrtfinále Poháru UEFA. Tam ho zastavila Borussia Mönchengladbach, pozdější vítěz soutěže.', None),
    (1976, 'Premiérový titul mistra ligy', 'Po podzimu byl tým trenéra Jiřího Rubáše až dvanáctý. Na jaře ale neprohrál osm kol v řadě a výhrou v Plzni v posledním kole slavil první titul.', 'Premiérový titul'),
    (1976, 'Výhra nad Bayernem Mnichov', 'Dvacátého října 1976 porazil Baník na vyprodaných Bazalech před 32 tisíci diváky Bayern s Beckenbauerem a Müllerem 2:1. Góly dali Lorenc a Lička.', None),
    (1979, 'Semifinále Poháru vítězů pohárů', 'Pod Evženem Hadamczikem vyřadil Baník Sporting Lisabon, Shamrock Rovers i Magdeburk. Do finále mu chyběl jediný krok, v semifinále nestačil na Fortunu Düsseldorf.', 'Bez triumfu, ale v semifinále'),
    (1980, 'Druhý titul pod Hadamczikem', 'Baník kráčel za titulem od začátku a mistrem byl už čtyři kola před koncem. Útočník Lička se stal králem střelců.', None),
    (1981, 'Obhajoba a Bayern podruhé', 'Generace bronzových medailistů z ME 1980 a olympijských vítězů obhájila titul. V Poháru mistrů došla do čtvrtfinále, kde opět narazila na Bayern.', None),
    (1991, 'Dva poháry v jednom roce', 'Tým trenéra Jaroslava Gürtlera vyhrál Český pohár i finále Československého poháru, kde porazil Spartak Trnava 6:1.', None),
    (2004, 'Nečekaný třetí titul', 'Parta trenéra Františka Komňackého kolem Látala, Heinze a Bolfa senzačně ovládla ligu a Ostravsko zachvátila fotbalová euforie. Titul jistila výhra v Olomouci.', 'Nečekaný triumf'),
    (2005, 'Vítěz Poháru ČMFS', 'Pod Jozefem Jarabinským vyhrál Baník finále Poháru ČMFS v Olomouci nad Slováckem 2:1.', None),
    (2010, 'Bronz s Koubkem a Vydrou', 'Tým trenéra Miroslava Koubka bojoval o titul až do předposledního kola a sezónu 2009/2010 zakončil na třetím místě.', None),
    (2013, 'Záchrana klubu', 'Návrat Milana Baroše se stal symbolem jarní záchrany. Ostravští zastupitelé odkoupili Bazaly a odvrátili zánik klubu.', None),
    (2016, 'Sestup a nový majitel', 'Po padesáti letech Baník sestoupil. V lednu 2016 klub koupil Václav Brabec a finančně ho stabilizoval.', None),
    (2017, 'Král je zpět', 'Výhrou 3:0 nad Znojmem na vyprodaném Městském stadionu uhájil Baník druhé místo a po roce se vrátil do nejvyšší soutěže.', None),
    (2019, 'Finále MOL Cupu', 'Tým Bohumila Páníka se probojoval do skupiny o titul a do finále MOL Cupu, kde v Olomouci podlehl Slavii.', None),
    (2024, 'Návrat do Evropy po 14 letech', 'Pod Pavlem Hapalem porazil Baník v rozhodujícím zápase Slovácko 6:0 a vrátil se do evropských pohárů. V Konferenční lize vyřadil Urartu.', None),
    (2025, 'Bodový rekord', 'Bronzová sezóna s rekordními 64 body po základní části. Baník v ní po letech vyhrál na Letné i v Plzni.', None),
]

def history():
    """Curated milestones; photos come from the matching sections of /zobraz.asp?t=historie."""
    root = page(BASE+'/zobraz.asp?t=historie')
    content = next(n for n in root.all('div') if 'content' in n.classes() and any(h.text() == 'Historie klubu' for h in n.all('h1')))
    photos_by_section, section = {}, None
    for node in content.all():
        if node.tag == 'h3' or (node.tag == 'p' and node.first('strong') and clean(node.text()) == clean(node.first('strong').text()) and 3 < len(node.text()) < 60):
            section = node.text()
        elif section and node.tag == 'img':
            photos_by_section.setdefault(section, []).append(urllib.parse.urljoin(BASE+'/', node.attrs['src']))
    missing = [s for *_, s in MILESTONES if s and s not in photos_by_section]
    if missing:
        print('history photos not found for:', ', '.join(missing))
    folder = ROOT/'dist'/'assets'/'history'
    folder.mkdir(parents=True, exist_ok=True)
    milestones, counter = [], 0
    for year, label, text, photo_section in MILESTONES:
        milestone = {'year': year, 'label': label, 'text': text}
        for source in photos_by_section.get(photo_section, [])[:1]:
            try:
                im = image(source).convert('RGB')
                im.thumbnail((1400, 1400))
                counter += 1
                name = f'{counter:02d}-{year}.jpg'
                im.save(folder/name, 'JPEG', quality=82, optimize=True, progressive=True)
                milestone['photos'] = [{'file': f'assets/history/{name}', 'source': source, 'width': im.width, 'height': im.height}]
            except Exception as error:  # a missing photo must not block the text
                print('history photo skipped:', source, error)
        milestones.append(milestone)
    return {'source': BASE+'/zobraz.asp?t=historie', 'milestones': milestones}

def write_content(data):
    output = '(function(root){const content='+json.dumps(data, ensure_ascii=False)+';if(typeof module!=="undefined")module.exports=content;else root.ClubContent=content;})(globalThis);\n'
    (ROOT/'dist'/'club-content.js').write_text(output, encoding='utf-8')

def load_content():
    text = (ROOT/'dist'/'club-content.js').read_text(encoding='utf-8')
    start = text.index('const content=') + len('const content=')
    return json.loads(text[start:text.rindex('};if(')+1])

def main():
    items = roster()
    if len(items) < 15:
        raise ValueError('Roster unexpectedly short; previous snapshot preserved')
    logos = partners()
    if len(logos) < 10:
        raise ValueError('Partners unexpectedly short; previous snapshot preserved')
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        players = list(pool.map(profile, items))
    club_logo()
    story = history()
    data = {'updatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'rosterSource': f'{BASE}/soupiska.asp?kategorie=MUZ', 'partnersSource': BASE+'/partneri.asp', 'players': players, 'partners': logos, 'history': story}
    write_content(data)
    print(f'Downloaded {len(players)} profiles/photos, {len(logos)} partner logos and {len(story["milestones"])} history milestones.')

if __name__ == '__main__':
    if '--history-only' in sys.argv:
        data = load_content()
        data['history'] = history()
        write_content(data)
        print(f'Downloaded {len(data["history"]["milestones"])} history milestones and {sum(len(m.get("photos",[])) for m in data["history"]["milestones"])} photos.')
    else:
        main()
