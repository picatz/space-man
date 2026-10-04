'use strict';
// Independent decoder of rendered pixels. Test tooling only: Python's standard
// library + system libzbar; no runtime dependency is added to Space Man.
const {execFileSync}=require('node:child_process');
function decodePixels(width,height,rgba){
 const script=String.raw`import sys,json,base64,ctypes as C,ctypes.util
p=json.load(sys.stdin); a=base64.b64decode(p['rgba']); gray=bytes((a[i]*299+a[i+1]*587+a[i+2]*114)//1000 for i in range(0,len(a),4))
name=ctypes.util.find_library('zbar')
if not name: raise RuntimeError('QR acceptance requires system libzbar (Ubuntu: libzbar0)')
z=C.CDLL(name)
def api(name,result,args):
 f=getattr(z,name); f.restype=result; f.argtypes=args; return f
ptr=C.c_void_p; u=C.c_uint
scanner=api('zbar_image_scanner_create',ptr,[])()
api('zbar_image_scanner_set_config',C.c_int,[ptr,C.c_int,C.c_int,C.c_int])(scanner,64,0,1)
image=api('zbar_image_create',ptr,[])()
api('zbar_image_set_format',None,[ptr,C.c_ulong])(image,0x30303859)
api('zbar_image_set_size',None,[ptr,u,u])(image,p['width'],p['height'])
buf=C.create_string_buffer(gray)
api('zbar_image_set_data',None,[ptr,ptr,C.c_ulong,ptr])(image,C.cast(buf,ptr),len(gray),None)
api('zbar_scan_image',C.c_int,[ptr,ptr])(scanner,image)
sym=api('zbar_image_first_symbol',ptr,[ptr])(image)
if not sym: raise RuntimeError('No QR decoded from rendered pixels')
raw=api('zbar_symbol_get_data',C.c_char_p,[ptr])(sym)
print(raw.decode('utf-8'))
api('zbar_image_destroy',None,[ptr])(image)
api('zbar_image_scanner_destroy',None,[ptr])(scanner)
`;
 return execFileSync('python3',['-c',script],{input:JSON.stringify({width,height,rgba:Buffer.from(rgba).toString('base64')}),encoding:'utf8',maxBuffer:8*1024*1024}).trim();
}
function canvasContext(canvas){
 let pixels=new Uint8Array(canvas.width*canvas.height*4);
 const ctx={fillStyle:'#000',get pixels(){return pixels;},clearRect(){pixels=new Uint8Array(canvas.width*canvas.height*4);},fillRect(x,y,w,h){
  if(pixels.length!==canvas.width*canvas.height*4)pixels=new Uint8Array(canvas.width*canvas.height*4);
  let hcolor=ctx.fillStyle.slice(1);if(hcolor.length===3)hcolor=hcolor.split('').map(x=>x+x).join('');
  const rgb=[0,2,4].map(i=>parseInt(hcolor.slice(i,i+2),16));
  for(let yy=Math.max(0,y);yy<Math.min(canvas.height,y+h);yy++)for(let xx=Math.max(0,x);xx<Math.min(canvas.width,x+w);xx++){let i=(yy*canvas.width+xx)*4;pixels.set([...rgb,255],i);}
 }};return ctx;
}
function attachCanvasDOM(c){
 const nodes=[];
 c.context.document.createElement=tag=>{
  const n={tagName:tag.toUpperCase(),children:[],attrs:{},style:{},listeners:{},width:0,height:0,hidden:false,
   appendChild(e){this.children.push(e);return e;},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,f){this.listeners[k]=f;},replaceChildren(){this.children=[];},focus(){},remove(){},querySelectorAll(){return[];}};
  if(tag==='canvas'){const ctx=canvasContext(n);n.getContext=()=>ctx;}
  nodes.push(n);return n;
 };return nodes;
}
module.exports={decodePixels,canvasContext,attachCanvasDOM};
