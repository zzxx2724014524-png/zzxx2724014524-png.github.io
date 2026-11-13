// 阿导海钓 data — from game_design.md v0.3 (稀有度、体重为文档值；未注来源的为示意)
// w: [常见下限, 常见上限(=大物下限), 大物上限, 巨物上限] kg
window.SPOTS = [
  { id: 'xiaoxing', name: '小星山', lv: 1, fee: 1, lead: '60–80 g', ride: '快艇约 15–25 分钟', mvp: true },
  { id: 'fengche',  name: '风车塔', lv: 2, fee: 3, lead: '80–100 g', ride: '出船约 1 小时', mvp: true },
  { id: 'daqing',   name: '大青针', lv: 3, fee: 5, lead: '200 g', ride: '约 20–22 海里', mvp: false },
  { id: 'youjing',  name: '油井',   lv: 4, fee: 20, lead: '500 g', ride: '3 天 2 夜', mvp: false },
];
window.FISH = [
  ['shijiu','石九公','褐菖鲉 Sebastiscus marmoratus','xiaoxing',1,[0.1,0.3,0.6,1.0]],
  ['nimeng','泥猛','褐篮子鱼 Siganus fuscescens','xiaoxing',1,[0.1,0.3,0.6,1.0]],
  ['mayou','马友','四指马鲅 Eleutheronema tetradactylum','xiaoxing',2,[0.3,1.5,4,8]],
  ['shiban','石斑','石斑鱼属（种未定）','xiaoxing',2,[0.3,1,3,5]],
  ['huangjiaoli','黄脚立','黄鳍棘鲷 Acanthopagrus latus','xiaoxing',1,[0.2,0.5,1,1.5]],
  ['shajian','沙尖','多鳞鱚 Sillago sihama','xiaoxing',1,[0.05,0.15,0.25,0.35]],
  ['heidiao','黑鲷','黑棘鲷 Acanthopagrus schlegelii','xiaoxing',2,[0.3,0.8,1.8,3.2]],
  ['huangchang','黄立鲳','布氏鲳鲹 Trachinotus blochii','xiaoxing',2,[0.5,1.5,2.5,3.4]],
  ['majiao','马鲛','康氏马鲛 Scomberomorus commerson','fengche',2,[1,5,12.5,20]],
  ['yanzai','烟仔','扁舵鲣 Auxis thazard','fengche',2,[0.8,1.5,2,2.5]],
  ['junzao','军曹','军曹鱼 Rachycentron canadum','fengche',3,[3,8,15,25]],
  ['zhendiao','真鲷','真鲷 Pagrus major','fengche',3,[0.5,1.5,3,6]],
  ['hongshan','红衫','金线鱼 Nemipterus virgatus','fengche',2,[0.1,0.25,0.4,0.6]],
  ['chizai','池仔','蓝圆鲹 Decapterus maruadsi','fengche',1,[0.15,0.4,0.7,1.0]],
  ['guitoudao','鬼头刀','鲯鳅 Coryphaena hippurus','fengche',3,[2,6,12,25]],
  ['lalun','拉伦','双带鲹 Elagatis bipinnulata','fengche',3,[2,5,10,15]],
  ['huangji','黄鸡','学名待确认','daqing',2,[0.5,1.5,3,4]],
  ['hongyou','红油','紫红笛鲷 Lutjanus argentimaculatus','daqing',3,[1,3,6,12]],
  ['hongban','红斑','赤点石斑鱼 Epinephelus akaara','daqing',3,[0.4,1,1.5,2.5]],
  ['huodian','火点','勒氏笛鲷 Lutjanus russellii','daqing',2,[0.5,1.5,2.5,3]],
  ['gt','GT','浪人鲹 Caranx ignobilis','youjing',5,[5,15,25,40]],
  ['jinqiang','金枪','黄鳍金枪鱼 Thunnus albacares','youjing',4,[1,6,15,40]],
  ['dashiban','大石斑','大型石斑（种未定）','youjing',4,[5,10,22,60]],
  ['zhanghong','章红','高体鰤 Seriola dumerili','youjing',4,[4,12.5,25,65]],
  ['hailang','海狼','魣属（种未定）','youjing',4,[1,4,10,20]],
  ['daidai','大带鱼','带鱼 Trichiurus japonicus','youjing',3,[1,2,3.5,5]],
].map(([id, name, sci, spot, stars, w]) => ({ id, name, sci, spot, stars, w }));
window.TIPS = [
  '【阿导知识】中鱼后别猛摇，竿子保持弯，匀速收线。',
  '【阿导知识】记住中鱼时五彩线的颜色，下一竿放到同一水层。',
  '【阿导知识】流急换重铅：小星山 60–80，风车塔 80–100。',
  '【阿导知识】挂底了别硬拉，用木棍或戴手套处理。',
  '【阿导知识】不认识的鱼用毛巾抓，小心背鳍。',
  '【阿导知识】鱼冲的时候松手让线，等它冲完再收。',
];
// 每种鱼的搏鱼行为参数（游戏示意值，不是实测数据）。每次中鱼会再乘 0.85–1.15 的随机系数。
// speed 平时游速(m/s)  burst 冲刺速度(m/s)  freq 每 10 秒平均冲刺次数  dur 每次冲刺秒数
// pull 拉力(0–1)  fatigue 疲劳速度(越大越快累)  bite 看饵后咬口意愿  style 主要冲法：lateral 横冲 / dive 下钻 / run 远跑
// rerun 力竭后缓过劲再冲一次的概率
// 体长（cm，对应 w[1]“常见上限”体重时的大致全长；示意，用于水下画面按真实比例缩放）
window.FISH_LEN = { shijiu: 22, nimeng: 24, mayou: 50, shiban: 35, huangjiaoli: 28, shajian: 24, heidiao: 33, huangchang: 38,
  majiao: 90, yanzai: 42, junzao: 100, zhendiao: 42, hongshan: 24, chizai: 28, guitoudao: 100, lalun: 80,
  huangji: 40, hongyou: 55, hongban: 35, huodian: 40, gt: 95, jinqiang: 75, dashiban: 85, zhanghong: 110, hailang: 100, daidai: 120 };
window.FISH_AI = {
  shijiu:      [0.4, 1.5, 1.0, 0.6, 0.25, 1.4, 0.85, 'dive', 0.0],   // 石九公：好钓，偶尔往礁里钻
  nimeng:      [0.8, 2.5, 3.0, 0.8, 0.35, 1.1, 0.80, 'lateral', 0.1],
  mayou:       [1.4, 5.0, 4.0, 1.4, 0.45, 0.9, 0.70, 'lateral', 0.3], // 马友：横向快冲
  shiban:      [0.5, 3.0, 2.0, 1.0, 0.60, 1.0, 0.75, 'dive', 0.1],    // 石斑：往礁洞钻
  huangjiaoli: [0.8, 3.0, 3.0, 0.8, 0.40, 1.0, 0.75, 'dive', 0.15],
  shajian:     [0.6, 1.8, 2.0, 0.5, 0.20, 1.5, 0.85, 'lateral', 0.0],
  heidiao:     [0.9, 4.0, 3.0, 0.9, 0.70, 0.9, 0.60, 'dive', 0.25],   // 黑鲷：突然下钻，张力高
  huangchang:  [1.2, 4.5, 3.0, 1.2, 0.50, 0.9, 0.65, 'lateral', 0.3],
  majiao:      [2.0, 8.0, 3.0, 0.9, 0.55, 1.1, 0.65, 'run', 0.2],     // 马鲛：爆发极快、累得也快
  yanzai:      [1.8, 6.5, 4.0, 1.3, 0.55, 0.8, 0.70, 'run', 0.35],
  junzao:      [1.0, 5.0, 2.5, 1.6, 0.75, 0.7, 0.55, 'run', 0.4],     // 军曹：到船边还会再冲
  zhendiao:    [1.0, 4.0, 3.0, 1.0, 0.60, 0.9, 0.55, 'dive', 0.25],
  hongshan:    [0.6, 2.0, 2.0, 0.6, 0.25, 1.3, 0.85, 'dive', 0.0],
  chizai:      [1.2, 3.0, 3.0, 0.6, 0.25, 1.3, 0.90, 'lateral', 0.0],
  guitoudao:   [1.8, 6.0, 4.0, 1.0, 0.55, 0.9, 0.60, 'lateral', 0.35],
  lalun:       [1.9, 7.0, 3.5, 1.3, 0.60, 0.8, 0.55, 'run', 0.35],
  huangji:     [0.7, 3.0, 3.0, 0.8, 0.45, 1.0, 0.75, 'dive', 0.15],
  hongyou:     [0.9, 5.0, 2.5, 1.2, 0.80, 0.8, 0.50, 'dive', 0.3],
  hongban:     [0.5, 3.5, 2.0, 1.0, 0.65, 1.0, 0.60, 'dive', 0.15],
  huodian:     [0.8, 3.5, 3.0, 0.8, 0.50, 1.0, 0.70, 'dive', 0.2],
  gt:          [1.6, 7.0, 3.0, 1.8, 1.00, 0.6, 0.40, 'run', 0.5],
  jinqiang:    [2.0, 7.0, 1.5, 3.0, 0.85, 0.5, 0.45, 'run', 0.5],     // 金枪：长时间持续远跑
  dashiban:    [0.6, 4.0, 2.0, 1.5, 1.00, 0.6, 0.45, 'dive', 0.3],
  zhanghong:   [1.4, 6.0, 2.5, 2.0, 0.95, 0.55, 0.45, 'dive', 0.45],
  hailang:     [2.2, 8.0, 2.0, 0.8, 0.60, 1.0, 0.50, 'run', 0.2],
  daidai:      [0.8, 3.0, 2.0, 0.8, 0.45, 1.1, 0.65, 'lateral', 0.1],
};
