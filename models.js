// V2, read-only copies of the supplied assets. Same position, scale and camera for every look.
// Desktop HD is selected only for wide fine-pointer devices. All other devices use mobile.
export const models = [
  { id: 'puffer', label: 'Glossy puffer', stem: 'zhuangzhuang-standing-black-puffer', description: 'Zhuangzhuang, a cream French bulldog, standing in a black glossy puffer vest' },
  { id: 'fleece', label: 'Green fleece', stem: 'zhuangzhuang-standing-green-fleece', description: 'Zhuangzhuang, a cream French bulldog, standing in a green fleece jacket' },
  { id: 'cotton', label: 'Blue T-shirt', stem: 'zhuangzhuang-standing-blue-tee', description: 'Zhuangzhuang, a cream French bulldog, standing in a blue cotton T-shirt' },
  { id: 'base', label: 'Before outfit', stem: 'zhuangzhuang-standing-base', description: 'Zhuangzhuang, a cream French bulldog, standing without clothing' },
];
export const useDesktopAssets = (width, finePointer, touchPoints, saveData) => width >= 1200 && finePointer && touchPoints === 0 && !saveData;
export const modelUrl = (index, tier) => `./assets/v2/${tier}/${models[index].stem}.glb`;
export const posterUrl = index => `./assets/v2/posters/${models[index].stem}.webp`;
