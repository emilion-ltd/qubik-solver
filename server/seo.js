const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createSEO(html, configuredURL) {
  let base=null;
  if(configuredURL) {
    const parsed=new URL(configuredURL);
    if(parsed.protocol==='https:' && !['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)) {
      if(parsed.username || parsed.password || parsed.pathname!=='/' || parsed.search || parsed.hash) throw new Error('PUBLIC_BASE_URL must be the public HTTPS origin without a path, query or credentials');
      base=parsed.origin+'/';
    }
  }
  if(!base) return {
    html:html.replace('content="index,follow,max-image-preview:large"','content="noindex,nofollow"'),
    robots:'User-agent: *\nDisallow: /\n',
    sitemap:null
  };
  const url=escape(base),image=escape(base+'icons/icon-512.png');
  const graph={"@context":"https://schema.org","@type":"WebSite",name:"CubeSolve",alternateName:"פותר הקובייה של CubeSolve",url:base,inLanguage:"he"};
  const extra='<link rel="canonical" href="'+url+'">\n<meta property="og:url" content="'+url+'">\n<script type="application/ld+json">'+JSON.stringify(graph).replace(/</g,'\\u003c')+'</script>';
  return {
    html:html.replace('<!-- deployment-seo -->',extra).replaceAll('content="./icons/icon-512.png"','content="'+image+'"'),
    robots:'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /pay/\nDisallow: /server/\nSitemap: '+base+'sitemap.xml\n',
    sitemap:'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>'+url+'</loc></url></urlset>'
  };
}
