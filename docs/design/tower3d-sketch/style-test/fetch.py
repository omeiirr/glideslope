import json, math, io, sys, urllib.request, urllib.parse
from PIL import Image
e = json.load(open('/home/omeir/Work/atc/data/airports/EHAM.json'))
lat0, lon0 = e['lat'], e['lon']; cl = math.cos(math.radians(lat0))
def deg(x, z): return lat0 - z / 111320, lon0 + x / (111320 * cl)   # frame: x east, z south (m)
def fetch(name, xmin, xmax, zmin, zmax, mpp, layer):
    W, H = round((xmax - xmin) / mpp), round((zmax - zmin) / mpp)
    nx, ny = math.ceil(W / 1200), math.ceil(H / 1200)
    out = Image.new('RGB', (W, H))
    for i in range(nx):
        for j in range(ny):
            px0, px1 = i * W // nx, (i + 1) * W // nx; py0, py1 = j * H // ny, (j + 1) * H // ny
            la1, lo0 = deg(xmin + px0 * mpp, zmin + py0 * mpp); la0, lo1 = deg(xmin + px1 * mpp, zmin + py1 * mpp)
            q = urllib.parse.urlencode(dict(service='WMS', version='1.3.0', request='GetMap', layers=layer, styles='', crs='EPSG:4326',
                bbox=f'{la0},{lo0},{la1},{lo1}', width=px1 - px0, height=py1 - py0, format='image/jpeg'))
            req = urllib.request.Request('https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?' + q, headers={'User-Agent': 'design-sketch'})
            raw = urllib.request.urlopen(req, timeout=120).read()
            if raw[:2] != b'\xff\xd8': print(raw[:400]); sys.exit(1)
            im = Image.open(io.BytesIO(raw))
            out.paste(im, (px0, py0)); print(name, i, j, im.size, flush=True)
    out.save(f'{name}.jpg', quality=88)
    json.dump(dict(xmin=xmin, xmax=xmax, zmin=zmin, zmax=zmax), open(f'{name}.json', 'w'))
tw = ((4.71787 - lon0) * 111320 * cl, -(52.3317 - lat0) * 111320)
print('tower west frame', tw)
fetch('outer', -30000, 30000, -30000, 30000, 12.5, 'Actueel_ortho25')
fetch('mid', -9000, 7000, -10000, 6000, 3.2, 'Actueel_ortho25')
fetch('inner', tw[0] - 2600, tw[0] + 2200, tw[1] - 4400, tw[1] + 1400, 0.8, 'Actueel_orthoHR')
